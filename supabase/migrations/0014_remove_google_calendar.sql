-- ============================================================================
-- Schela — remove Google Calendar as an integration
-- Run after 0013_ai_decision_reasoning.sql.
--
-- Replaced by Outlook (calendar sync + free/busy) and Zoom (meeting links).
-- Google's OAuth verification process — app review, demo video requirements,
-- Limited Use compliance questionnaires — was disproportionate friction for
-- what the integration provided, especially against Outlook's comparatively
-- light publisher verification and Zoom's no-personal-data-scope review.
--
-- Any org that had connected Google Calendar loses that row entirely (not
-- just disconnected) since the application code no longer references "gcal"
-- anywhere — a disconnected-but-present row would just be dead data with no
-- UI to ever show it again.
-- ============================================================================

delete from integrations where id = 'gcal';
