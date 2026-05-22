import path from 'path';
import { promises as fsp } from 'fs';
import { LogicTemplateSchema, RiskTemplateSchema } from '../schemas/strategy.schema.js';

class TemplateService {
  constructor() {
    this.templatesDir = path.join(process.cwd(), 'templates');
  }

  async loadTemplate(type, id) {
    try {
      const filePath = path.join(this.templatesDir, type, `${id}.json`);
      const data = await fsp.readFile(filePath, 'utf8');
      return JSON.parse(data);
    } catch (err) {
      return null;
    }
  }

  async saveTemplate(type, id, data) {
    const schema = type === 'logic' ? LogicTemplateSchema : RiskTemplateSchema;
    schema.parse(data);

    const dir = path.join(this.templatesDir, type);
    await fsp.mkdir(dir, { recursive: true });

    const filePath = path.join(dir, `${id}.json`);
    await fsp.writeFile(filePath, JSON.stringify(data, null, 2));
  }

  async listTemplates(type, lockChecker) {
    const dir = path.join(this.templatesDir, type);
    try {
      const files = await fsp.readdir(dir);
      const jsonFiles = files.filter(f => f.endsWith('.json'));

      return await Promise.all(jsonFiles.map(async (f) => {
        const id = f.replace('.json', '');
        const content = await this.loadTemplate(type, id);
        const lock = await lockChecker(type, id);
        return {
          id,
          name: content?.name || id,
          ...lock
        };
      }));
    } catch (err) {
      return [];
    }
  }

  async deleteTemplate(type, id) {
    const filePath = path.join(this.templatesDir, type, `${id}.json`);
    await fsp.unlink(filePath);
  }

  async duplicateTemplate(type, id, newId) {
    const data = await this.loadTemplate(type, id);
    if (!data) throw new Error(`Template ${id} of type ${type} not found`);
    await this.saveTemplate(type, newId, data);
  }
}

export const templateService = new TemplateService();
