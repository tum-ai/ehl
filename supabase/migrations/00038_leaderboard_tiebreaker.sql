-- Add alphabetical tiebreaker to leaderboard view.
-- Sorting: points DESC, best_placement ASC, team_name ASC.

CREATE OR REPLACE VIEW leaderboard AS
SELECT
  t.id AS team_id,
  t.name AS team_name,
  t.slug AS team_slug,
  t.logo_url,
  t.university,
  t.city AS origin,
  coalesce(sum(s.points) FILTER (WHERE s.published), 0) AS total_points,
  count(s.chapter_id) FILTER (WHERE s.published) AS matches_played,
  min(s.placement) FILTER (WHERE s.published AND s.placement IS NOT NULL) AS best_finish,
  rank() OVER (
    ORDER BY
      coalesce(sum(s.points) FILTER (WHERE s.published), 0) DESC,
      min(s.placement) FILTER (WHERE s.published AND s.placement IS NOT NULL) ASC NULLS LAST,
      t.name ASC
  ) AS rank
FROM teams t
LEFT JOIN scores s ON t.id = s.team_id
WHERE t.status = 'active'
GROUP BY t.id, t.name, t.slug, t.logo_url, t.university, t.city;
