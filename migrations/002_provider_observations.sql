UPDATE providers
SET playback_type='iframe', adapter_state='implemented', hostname='megaplay.buzz',
    capabilities_json='{"embed":true,"fullscreen":true}',
    observed_limitation='Observed public resolver output points to a MegaPlay iframe route; frame loading and playback remain separately verified states.',
    last_seen_at='2026-09-10T04:30:00.000Z', updated_at='2026-09-10T04:30:00.000Z'
WHERE id IN ('vidstream-2','hd-1','hd-2');

INSERT INTO verification_observations(entity_type,entity_id,stage,result,reason_code,evidence_class,details_json,observed_at) VALUES
 ('provider','vidstream-2','source_resolved','resolved',NULL,'direct_observation','{"hostname":"megaplay.buzz","pathPrefix":"/stream/s-2/","sampleScope":"Bleach episode 1 SUB","playerLoaded":false,"playbackVerified":false}','2026-09-10T04:30:00.000Z'),
 ('provider','hd-1','source_resolved','resolved',NULL,'direct_observation','{"hostname":"megaplay.buzz","pathPrefix":"/stream/s-2/","sampleScope":"Bleach episode 1 SUB","playerLoaded":false,"playbackVerified":false}','2026-09-10T04:30:00.000Z'),
 ('provider','hd-2','source_resolved','resolved',NULL,'direct_observation','{"hostname":"megaplay.buzz","pathPrefix":"/stream/s-2/","sampleScope":"Bleach episode 1 SUB","playerLoaded":false,"playbackVerified":false}','2026-09-10T04:30:00.000Z');
