import { f } from './validation.js';

const MAX_BUDGET = 50_000_000;
const budget = () => f.number({ min: 1, max: MAX_BUDGET, required: true });

export const registerSchema = {
  username: f.string({ min: 3, max: 32, trim: true, pattern: /^[a-zA-Z0-9_.-]+$/, required: true }),
  email: f.nullableString({ max: 254, trim: true }),
  full_name: f.nullableString({ max: 120, trim: true }),
  password: f.string({ min: 8, max: 128, maxBytes: 72, required: true }),
};

export const homeSchema = {
  budget: budget(),
  rooms: f.string({ min: 1, max: 30, trim: true, required: true }),
  style: f.string({ min: 1, max: 60, trim: true, default: 'Modern' }),
  room_types: f.stringList({ max: 6 }),
  num_lights: f.integer({ min: 0, max: 500, default: 0 }),
  num_fans: f.integer({ min: 0, max: 500, default: 0 }),
  num_furniture: f.integer({ min: 0, max: 500, default: 0 }),
  num_dining_tables: f.integer({ min: 0, max: 100, default: 0 }),
  platforms: f.stringList({ max: 8, default: () => ['Amazon', 'Flipkart', 'IKEA'] }),
  preferences: f.string({ max: 1000, default: '' }),
};

export const partySchema = {
  budget: budget(),
  event_type: f.string({ min: 1, max: 80, trim: true, required: true }),
  guests: f.integer({ gt: 0, max: 10_000, required: true }),
  location: f.string({ max: 120, trim: true, default: 'Home' }),
  food_preference: f.string({ max: 120, trim: true, default: '' }),
  includes: f.stringList({ max: 8 }),
  notes: f.string({ max: 1000, trim: true, default: '' }),
};

export const jewelrySchema = {
  budget: budget(),
  occasion: f.string({ min: 1, max: 100, trim: true, required: true }),
  jewelry_types: f.stringList({ max: 8 }),
  metal_preference: f.string({ max: 80, trim: true, default: '' }),
  platforms: f.stringList({ max: 8, default: () => ['Amazon', 'Flipkart', 'Bluestone'] }),
  style_preferences: f.string({ max: 1000, trim: true, default: '' }),
  image: f.nullableString({ max: 7_000_000 }),
};

export const genericSchema = {
  category: f.oneOf(['home', 'party', 'jewelry'], { default: 'home' }),
  budget: budget(),
  preferences: f.record(),
};

export const sessionDataMaxBytes = 10_000;
