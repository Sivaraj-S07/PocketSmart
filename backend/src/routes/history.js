import { Router } from 'express';

export function historyRoutes({ db, auth }) {
  const router = Router();
  router.get('/history', auth.requireAuth, async (req, res) => {
    const history = await db.listRecommendations(req.user.id);
    res.json({ total: history.length, history });
  });

  router.delete('/history', auth.requireAuth, async (req, res) => {
    const deleted = await db.clearRecommendations(req.user.id);
    res.json({ message: 'History cleared successfully', deleted });
  });

  /** Full stored plan; 404 for unknown ids *and* for other users' plans. */
  router.get('/recommendation-details/:id', auth.requireAuth, async (req, res) => {
    const entry = await db.getRecommendation(req.user.id, req.params.id);
    if (!entry) return res.status(404).json({ detail: 'Recommendation not found' });
    let fullResult;
    try {
      fullResult = JSON.parse(entry.result);
    } catch {
      fullResult = { raw: entry.result };
    }
    res.json({
      id: entry.id,
      timestamp: entry.timestamp,
      type: entry.category,
      category: entry.category,
      budget: entry.budget,
      input: entry.preferences,
      full_result: fullResult,
    });
  });

  return router;
}
