import express from 'express';
import { templateService } from '../services/template.service.js';
import { strategyService } from '../services/strategy.service.js';
import { z } from 'zod';
import { slugify } from '../utils/string.js';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const logicTemplates = await templateService.listTemplates('logic', strategyService.checkTemplateLock);
    const riskTemplates = await templateService.listTemplates('risk', strategyService.checkTemplateLock);
    res.json({ logic: logicTemplates, risk: riskTemplates });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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

router.put('/:type/:id', async (req, res) => {
  const { type, id } = req.params;
  const { name, ...content } = req.body;
  try {
    const lock = await strategyService.checkTemplateLock(type, id);
    if (lock.isLocked) {
      return res.status(403).json({
        error: 'Template is locked because it is used by running strategies',
        activeStrategies: lock.usedBy
      });
    }
    const original = await templateService.loadTemplate(type, id);
    if (!original) {
      return res.status(404).json({ error: `Template ${id} of type ${type} not found` });
    }
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

router.delete('/:type/:id', async (req, res) => {
  const { type, id } = req.params;
  try {
    const lock = await strategyService.checkTemplateLock(type, id);
    if (lock.isLocked) {
      return res.status(403).json({
        error: 'Template is locked because it is used by running strategies',
        activeStrategies: lock.usedBy
      });
    }
    const template = await templateService.loadTemplate(type, id);
    if (!template) {
      return res.status(404).json({ error: `Template ${id} of type ${type} not found` });
    }
    await templateService.deleteTemplate(type, id);
    res.json({ status: 'deleted', id, type });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
