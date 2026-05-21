-- Add alphabetical tiebreaker to leaderboard view for display order.
-- rank() uses only points + best_placement (equal points = equal rank).
-- team_name is added as a display tiebreaker (not part of rank calculation).

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
      min(s.placement) FILTER (WHERE s.published AND s.placement IS NOT NULL) ASC NULLS LAST
  ) AS rank,
  t.name AS sort_name
FROM teams t
LEFT JOIN scores s ON t.id = s.team_id
WHERE t.status = 'active'
GROUP BY t.id, t.name, t.slug, t.logo_url, t.university, t.city;
