import { Router } from 'express';
import { validate } from '../validation.js';
import { homeSchema, partySchema, jewelrySchema, genericSchema } from '../schemas.js';
import { decodeImage } from '../image.js';

const pick = (source, keys) => Object.fromEntries(keys.map((k) => [k, source[k]]));

export function plannerRoutes({ auth, createPlan }) {
  const router = Router();
  const parse = (schema, req, res) => {
    const { value, issues } = validate(schema, req.body);
    if (issues) {
      res.status(422).json({ detail: issues });
      return null;
    }
    return value;
  };

  router.post('/generate-home', auth.requireAuth, async (req, res) => {
    const data = parse(homeSchema, req, res);
    if (!data) return;
    const preferences = pick(data, [
      'rooms', 'style', 'room_types', 'platforms', 'preferences',
      'num_lights', 'num_fans', 'num_furniture', 'num_dining_tables',
    ]);
    res.json(await createPlan(req.user, 'home', data, preferences));
  });

  router.post('/generate-party', auth.requireAuth, async (req, res) => {
    const data = parse(partySchema, req, res);
    if (!data) return;
    const preferences = pick(data, ['event_type', 'guests', 'location', 'food_preference', 'includes', 'notes']);
    res.json(await createPlan(req.user, 'party', data, preferences));
  });

  router.post('/generate-jewelry', auth.requireAuth, async (req, res) => {
    const data = parse(jewelrySchema, req, res);
    if (!data) return;
    const [imageData, mimeType] = decodeImage(data.image);
    const { image: _image, ...payload } = data;
    payload.image = Boolean(imageData);
    const preferences = pick(payload, ['occasion', 'jewelry_types', 'metal_preference', 'platforms', 'style_preferences']);
    res.json(await createPlan(req.user, 'jewelry', payload, preferences, imageData, mimeType));
  });

  /** Generic plan endpoint { category, budget, preferences }. */
  router.post('/recommendations-details', auth.requireAuth, async (req, res) => {
    const data = parse(genericSchema, req, res);
    if (!data) return;
    const payload = { ...data.preferences, budget: data.budget };
    res.json(await createPlan(req.user, data.category, payload, data.preferences));
  });

  return router;
}
