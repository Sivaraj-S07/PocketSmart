import crypto from 'node:crypto';

/** Generate a plan, save it to the user's history and return the API payload. */
export function createPlanner({ db, recommend }) {
  return async function createPlan(user, category, data, preferences, imageData = null, imageMimeType = null) {
    const [result, source] = await recommend(category, data, imageData, imageMimeType);
    const id = crypto.randomUUID();
    const timestamp = new Date().toISOString().replace(/\.(\d{3})Z$/, '.$1000+00:00');
    await db.saveRecommendation({
      id,
      userId: user.id,
      category,
      budget: Number(data.budget),
      preferences,
      result: JSON.stringify(result),
      timestamp,
    });
    return {
      recommendations: JSON.stringify(result),
      budget: data.budget,
      id,
      source,
    };
  };
}
