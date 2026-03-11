
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
      excludeMetadata: '',
    }, options);

    this.options.excludeMetadata = (this.options.excludeMetadata || '').split(',').map(s => s.trim()).filter(Boolean);

    this.options.filterValues = Array.isArray(this.options.filterValues) ? this.options.filterValues : this.options.filterValues.split(',').map(value => value.trim());

    const databaseId = getDatabaseId(database);

    this.database_id = databaseId;
    this.notion = new Client({
      auth: secret,
      notionVersion: '2022-06-28',
    });
    this.notion2md = new NotionToMarkdown({ notionClient: this.notion });

    this.notion2md.setCustomTransformer('synced_block', async (block) => {
      const { synced_block } = block;
      if (!synced_block) return '';

      // If it's a reference to another block
      if (synced_block.synced_from) {
        const originalBlockId = synced_block.synced_from.block_id;
        try {
          // Fetch the children of the original block
          const mdBlocks = await this.notion2md.pageToMarkdown(originalBlockId);
          return this.notion2md.toMarkdownString(mdBlocks);
        }
        catch (error) {
          console.error(`Error fetching synced block ${originalBlockId}:`, error);
          return '';
        }
      }

      // If it's the original block, let the default parser handle its children
      return false; // returning false tells notion-to-md to use default behavior
    });
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

    if (this.options.excludeMetadata) {
      this.options.excludeMetadata.forEach(key => delete article[key]);
    }

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
    let markdown = this.notion2md.toMarkdownString(mdBlocks);
    if (typeof markdown !== 'string') markdown = String(markdown || '');

    // Fix indentation issues with Notion toggles (especially headings with toggles).
    // notion-to-md indents children with 4 spaces or a tab, which GitHub renders as code blocks.
    // This regex matches a heading, then matches all subsequent lines that are either empty or indented.
    // It removes one level of indentation (up to 4 spaces or 1 tab) from each of those indented lines.
    markdown = markdown.replace(/(^#+ .*(?:\n|$))((?:^[ \t]*\n|^(?:\t| {1,4}).*(?:\n|$))*)/gm, (match, heading, children) => {
      return heading + (children || '').replace(/^(?:\t| {1,4})/gm, '');
    });

    return markdown;
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
    created_by: page.created_by.name || page.created_by.id,
    last_edited_by: page.last_edited_by.name || page.last_edited_by.id,

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
    created_by(prop) {
      return prop.created_by.name || prop.created_by.id;
    },
    last_edited_by(prop) {
      return prop.last_edited_by.name || prop.last_edited_by.id;
    },
    people(prop) {
      return prop.people.map(p => p.name || p.id).join(', ');
    },
    relation(prop) {
      return prop.relation.map(r => r.id).join(', ');
    },
    status(prop) {
      return prop.status?.name;
    },
    formula(prop) {
      return prop.formula?.string || prop.formula?.number || prop.formula?.boolean || prop.formula?.date?.start;
    },
  };
  const obj = {};
  for (const [key, value] of Object.entries(properties)) {
    if (types[value.type]) {
      obj[key] = types[value.type](value);
    }
    else {
      console.warn(`Unknown property type: ${value.type}`);
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
