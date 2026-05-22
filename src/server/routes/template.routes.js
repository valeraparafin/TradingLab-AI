import express from 'express';
import { botService } from '../services/bot.service.js';
import { templateService } from '../services/template.service.js';
import { strategyService } from '../services/strategy.service.js';
import { slugify } from '../utils/slug.js';
import { z } from 'zod';
import { RiskSettingsSchema } from '../schemas/strategy.schema.js';

const router = express.Router();

/**
 * GET /
 * Returns available logic and risk templates
 */
router.get('/', async (req, res) => {
  try {
    const logicTemplates = await templateService.listTemplates('logic', strategyService.checkTemplateLock.bind(strategyService));
    const riskTemplates = await templateService.listTemplates('risk', strategyService.checkTemplateLock.bind(strategyService));

    res.json({ logic: logicTemplates, risk: riskTemplates });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /:type/:id
 * Returns the content of a specific template
 */
router.get('/:type/:id', async (req, res) => {
  const { type, id } = req.params;
  try {
    const template = await templateService.loadTemplate(type, id);
    if (!template) {
      return res.status(404).json({ error: `Template ${id} of type ${type} not found` });
    }
    res.json(template);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /:type
 * Creates a new template
 */
router.post('/:type', async (req, res) => {
  const { type } = req.params;
  const { name, ...content } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Template name is required' });
  }

  try {
    const id = slugify(name);
    const templateData = { name, ...content };
    await templateService.saveTemplate(type, id, templateData);

    res.json({ id, name, type });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.message });
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

/**
 * PUT /:type/:id
 * Updates a template's name and content.
 * Enforces lock if the template is used by a running bot.
 */
router.put('/:type/:id', async (req, res) => {
  const { type, id } = req.params;
  const { name, ...content } = req.body;

  try {
    // 1. Check for lock
    const lock = await strategyService.checkTemplateLock(type, id);
    if (lock.isLocked) {
      return res.status(403).json({
        error: 'Template is locked because it is used by running strategies',
        activeStrategies: lock.usedBy
      });
    }

    // 2. Verify template exists
    const original = await templateService.loadTemplate(type, id);
    if (!original) {
      return res.status(404).json({ error: `Template ${id} of type ${type} not found` });
    }

    // 3. Update content (ID remains constant to avoid breaking strategy links)
    const templateData = { name: name || original.name, ...content };
    await templateService.saveTemplate(type, id, templateData);

    res.json({ id, name: templateData.name, type });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: err.message });
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

/**
 * POST /:type/:id/duplicate
 * Creates a copy of an existing template with a new name.
 */
router.post('/:type/:id/duplicate', async (req, res) => {
  const { type, id } = req.params;
  const { newName } = req.body;

  if (!newName) {
    return res.status(400).json({ error: 'newName is required for duplication' });
  }

  try {
    const newId = slugify(newName);
    await templateService.duplicateTemplate(type, id, newId);

    res.json({ id: newId, name: newName, type });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /:type/:id
 * Removes a template file.
 * Enforces lock if the template is used by a running bot.
 */
router.delete('/:type/:id', async (req, res) => {
  const { type, id } = req.params;

  try {
    // 1. Check for lock
    const lock = await strategyService.checkTemplateLock(type, id);
    if (lock.isLocked) {
      return res.status(403).json({
        error: 'Template is locked because it is used by running strategies',
        activeStrategies: lock.usedBy
      });
    }

    // 2. Verify template exists
    const template = await templateService.loadTemplate(type, id);
    if (!template) {
      return res.status(404).json({ error: `Template ${id} of type ${type} not found` });
    }

    // 3. Delete template
    await templateService.deleteTemplate(type, id);

    res.json({ status: 'deleted', id, type });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
