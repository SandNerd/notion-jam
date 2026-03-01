
import defaults from 'default-args';
import { Client } from '@notionhq/client';
import { NotionToMarkdown } from 'notion-to-md/build/notion-to-md.js';
import { convertPropsCase } from '../utils/transformVariables.js';

export class NotionModule {

  constructor({ secret, database }, options) {

    this.options = defaults({
      filterProp: 'Status',
      filterValues: 'Ready,Published',
      caseType: 'snake',
    }, options);

    this.options.filterValues = Array.isArray(this.options.filterValues) ? this.options.filterValues : this.options.filterValues.split(',').map(value => value.trim());

    const databaseId = getDatabaseId(database);

    this.database_id = databaseId;
    this.notion = new Client({ auth: secret });
    this.notion2md = new NotionToMarkdown({ notionClient: this.notion });

    const n2m = this.notion2md;
    const flattenBlockTransformer = async (block) => {
      const type = block.type;
      const richText = block[type].rich_text || [];

      let text = '';
      richText.forEach(content => {
        if (content.type === 'equation') {
          text += `$${content.equation.expression}$`;
          return;
        }
        let t = content.plain_text;
        t = n2m.annotatePlainText(t, content.annotations);
        if (content.href) t = `[${t}](${content.href})`;
        text += t;
      });

      if (type === 'heading_1') text = `# ${text}`;
      else if (type === 'heading_2') text = `## ${text}`;
      else if (type === 'heading_3') text = `### ${text}`;

      if (block.has_children) {
        const childMdBlocks = await n2m.pageToMarkdown(block.id);
        this._fixFlattenedBlocks(childMdBlocks);
        const childrenStr = (n2m.toMarkdownString(childMdBlocks)['parent'] || '').trim();
        if (childrenStr) return `${text}\n${childrenStr}`;
      }

      return text;
    };

    n2m.setCustomTransformer('toggle', flattenBlockTransformer);
    n2m.setCustomTransformer('heading_1', flattenBlockTransformer);
    n2m.setCustomTransformer('heading_2', flattenBlockTransformer);
    n2m.setCustomTransformer('heading_3', flattenBlockTransformer);
  }

  async fetchArticles() {
    const pages = await this._fetchPagesFromDb(this.database_id);
    return pages;
  }

  async getArticle(page) {
    let article = {
      id: page.id,
      title: getTitle(page),
      ...toPlainPage(page),
      ...toPlainProperties(page.properties),
      content: await this._getPageMarkdown(page.id),
    };

    if (this.options.caseType) {
      article = convertPropsCase(article, this.options.caseType);
    }

    return article;
  }

  async _fetchPagesFromDb(database_id) {
    const response = await this.notion.databases.query({
      database_id: database_id,
      filter: {
        or: [
          ...this.options.filterValues.map(value => ({
            property: this.options.filterProp, select: { equals: value }
          })),
        ]
      }
    });
    // TODO: paginate more than 100 pages
    return response.results;
  }

  async _getPageMarkdown(page_id) {
    const mdBlocks = await this.notion2md.pageToMarkdown(page_id);
    this._fixFlattenedBlocks(mdBlocks);
    return this.notion2md.toMarkdownString(mdBlocks)['parent'] || '';
  }

  _fixFlattenedBlocks(mdBlocks) {
    // Mutates in place: toggle blocks with empty children (because the custom transformer
    // already inlined their content) must be output as regular paragraphs since
    // notion-to-md v3 skips toggle parents in toMarkdownString when children are absent.
    mdBlocks.forEach(block => {
      if (block.type === 'toggle' && block.children.length === 0) {
        block.type = 'paragraph';
      }
      if (block.children && block.children.length > 0) {
        this._fixFlattenedBlocks(block.children);
      }
    });
  }

  async updateBlogStatus(page_id) {
    this.notion.pages.update({
      page_id: page_id,
      properties: {
        status: {
          select: {
            name: 'Published'
          }
        }
      }
    });
  }
}

function toPlainPage(page) {
  return {
    created_time: new Date(page.created_time),
    last_edited_time: new Date(page.last_edited_time),

    cover_image: page.cover?.external?.url || page.cover?.file.url,

    icon_image: page.icon?.file?.url,
    icon_emoji: page.icon?.emoji,
  };
}

function getTitle(page) {
  const titleProp = Object.values(page.properties).find(prop => prop.id === 'title');
  return titleProp.title[0]?.plain_text;
}

function toPlainProperties(properties) {
  const types = {
    title(prop) {
      return prop.title[0]?.plain_text;
    },
    rich_text(prop) {
      return prop.rich_text[0]?.plain_text;
    },
    number(prop) {
      return prop.number;
    },
    select(prop) {
      return prop.select?.name;
    },
    multi_select(prop) {
      return prop.multi_select.map(s => s.name);
    },
    date(prop) {
      return prop.date?.start ? new Date(prop.date?.start) : null;
    },
    files(prop) {
      const urls = prop.files?.map(file => file.file?.url || file.external?.url);
      return urls.length <= 1 ? urls[0] : urls;
    },
    checkbox(prop) {
      return prop.checkbox;
    },
    url(prop) {
      return prop.url;
    },
    email(prop) {
      return prop.email;
    },
    phone_number(prop) {
      return prop.phone_number;
    },
    created_time(prop) {
      return new Date(prop.created_time);
    },
    last_edited_time(prop) {
      return new Date(prop.last_edited_time);
    },
  };
  const obj = {};
  for (const [key, value] of Object.entries(properties)) {
    if (types[value.type]) {
      obj[key] = types[value.type](value);
    }
    else {
      console.warn(`Unknown block type: ${value.type}`);
      obj[key] = value[value.type];
    }
  }
  return obj;
}

function getDatabaseId(string) {
  const isValidId = str => /^[0-9a-f]{32}$/.test(str);
  if (isValidId(string)) return string;
  try {
    const parsedUrl = new URL(string);
    const id = parsedUrl.pathname.match(/\b([0-9a-f]{32})\b/)[1];
    if (isValidId(id)) return id;
    else throw new Error('URL does not contain a valid database id');
  }
  catch (error) {
    throw new Error('Database is not valid databaseID or Notion URL! ' + error);
  }
}
