-- ===========================================================================
-- 0004_report_templates.sql — the stock report library
--
-- System templates (business_id null) every tenant can use immediately. A
-- business may clone one and edit its own copy; these rows stay read-only.
--
-- Section/field shape (mirrored by ReportTemplateSections in src/lib/reports.ts):
--   [{ id, title, fields: [{ id, label, type, options?, required?, help? }] }]
-- type is one of: text | textarea | date | time | number | select | checkbox
--                 | photos | signature | table
-- ===========================================================================

insert into report_templates (business_id, key, name, description, is_system, sections)
values
(null, 'daily_site', 'Daily site report',
 'What happened on site today: crew, hours, weather, progress and photos.', true,
 '[
   {"id":"site","title":"Site","fields":[
     {"id":"weather","label":"Weather","type":"select","options":["Fine","Overcast","Light rain","Heavy rain","Wind","Extreme heat"],"required":true},
     {"id":"temperature","label":"Temperature (°C)","type":"number"},
     {"id":"site_conditions","label":"Site conditions","type":"textarea"},
     {"id":"delays","label":"Weather or access delays","type":"textarea"}
   ]},
   {"id":"crew","title":"Crew and hours","fields":[
     {"id":"crew_on_site","label":"Crew on site","type":"textarea","help":"One name per line"},
     {"id":"start_time","label":"Start","type":"time"},
     {"id":"finish_time","label":"Finish","type":"time"},
     {"id":"break_minutes","label":"Breaks (minutes)","type":"number"},
     {"id":"subcontractors","label":"Subcontractors on site","type":"textarea"}
   ]},
   {"id":"work","title":"Work completed","fields":[
     {"id":"work_completed","label":"Work completed today","type":"textarea","required":true},
     {"id":"materials_used","label":"Materials used","type":"textarea"},
     {"id":"equipment_used","label":"Plant and equipment","type":"textarea"},
     {"id":"deliveries","label":"Deliveries received","type":"textarea"},
     {"id":"issues","label":"Problems or delays","type":"textarea"},
     {"id":"tomorrow","label":"Planned for next shift","type":"textarea"}
   ]},
   {"id":"evidence","title":"Photos and sign-off","fields":[
     {"id":"photos","label":"Site photos","type":"photos"},
     {"id":"signature","label":"Signed by","type":"signature"}
   ]}
 ]'::jsonb),

(null, 'progress', 'Progress report',
 'Where the job is up to against program, for the client.', true,
 '[
   {"id":"summary","title":"Summary","fields":[
     {"id":"period","label":"Reporting period","type":"text","required":true},
     {"id":"percent_complete","label":"Percent complete","type":"number","required":true},
     {"id":"summary","label":"Progress summary","type":"textarea","required":true},
     {"id":"on_program","label":"On program","type":"select","options":["Ahead","On program","Behind"],"required":true}
   ]},
   {"id":"detail","title":"Detail","fields":[
     {"id":"completed","label":"Completed this period","type":"textarea"},
     {"id":"in_progress","label":"In progress","type":"textarea"},
     {"id":"next_period","label":"Planned next period","type":"textarea"},
     {"id":"variations","label":"Variations raised","type":"textarea"},
     {"id":"risks","label":"Risks and issues","type":"textarea"},
     {"id":"client_actions","label":"Actions required from client","type":"textarea"}
   ]},
   {"id":"evidence","title":"Photos and sign-off","fields":[
     {"id":"photos","label":"Progress photos","type":"photos"},
     {"id":"signature","label":"Prepared by","type":"signature"}
   ]}
 ]'::jsonb),

(null, 'defect', 'Defect report',
 'A fault found on site: what, where, how bad, and who fixes it.', true,
 '[
   {"id":"defect","title":"Defect","fields":[
     {"id":"location","label":"Location","type":"text","required":true},
     {"id":"element","label":"Element or trade","type":"text"},
     {"id":"description","label":"Description of defect","type":"textarea","required":true},
     {"id":"severity","label":"Severity","type":"select","options":["Minor","Moderate","Major","Critical"],"required":true},
     {"id":"cause","label":"Likely cause","type":"textarea"},
     {"id":"identified_by","label":"Identified by","type":"text"}
   ]},
   {"id":"rectification","title":"Rectification","fields":[
     {"id":"action_required","label":"Action required","type":"textarea","required":true},
     {"id":"responsible","label":"Responsible party","type":"text"},
     {"id":"due_date","label":"Rectify by","type":"date"},
     {"id":"cost_impact","label":"Cost impact","type":"textarea"},
     {"id":"status","label":"Status","type":"select","options":["Open","In progress","Rectified","Verified closed"]}
   ]},
   {"id":"evidence","title":"Photos and sign-off","fields":[
     {"id":"photos","label":"Defect photos","type":"photos"},
     {"id":"signature","label":"Reported by","type":"signature"}
   ]}
 ]'::jsonb),

(null, 'safety', 'Safety report',
 'Toolbox talk, hazards, controls and any incident on the day.', true,
 '[
   {"id":"talk","title":"Toolbox talk","fields":[
     {"id":"topic","label":"Topic","type":"text","required":true},
     {"id":"attendees","label":"Attendees","type":"textarea","help":"One name per line"},
     {"id":"duration_minutes","label":"Duration (minutes)","type":"number"}
   ]},
   {"id":"hazards","title":"Hazards and controls","fields":[
     {"id":"hazards","label":"Hazards identified","type":"textarea","required":true},
     {"id":"controls","label":"Controls in place","type":"textarea","required":true},
     {"id":"ppe","label":"PPE required","type":"textarea"},
     {"id":"swms_reviewed","label":"SWMS reviewed on site","type":"checkbox"},
     {"id":"permits","label":"Permits in force","type":"textarea"}
   ]},
   {"id":"incident","title":"Incidents","fields":[
     {"id":"incident_occurred","label":"Incident or near miss occurred","type":"checkbox"},
     {"id":"incident_detail","label":"What happened","type":"textarea"},
     {"id":"injuries","label":"Injuries","type":"textarea"},
     {"id":"immediate_action","label":"Immediate action taken","type":"textarea"},
     {"id":"reportable","label":"Notifiable to the regulator","type":"select","options":["No","Unsure — escalate","Yes"]}
   ]},
   {"id":"evidence","title":"Photos and sign-off","fields":[
     {"id":"photos","label":"Photos","type":"photos"},
     {"id":"signature","label":"Supervisor","type":"signature"}
   ]}
 ]'::jsonb),

(null, 'inspection', 'Inspection report',
 'A checklist walk-through with a pass/fail per item.', true,
 '[
   {"id":"scope","title":"Inspection","fields":[
     {"id":"inspection_type","label":"Type of inspection","type":"text","required":true},
     {"id":"area","label":"Area inspected","type":"text","required":true},
     {"id":"standard","label":"Against standard or spec","type":"text"},
     {"id":"inspector","label":"Inspector","type":"text"}
   ]},
   {"id":"items","title":"Checklist","fields":[
     {"id":"checklist","label":"Items","type":"table","help":"Item, result, comment"},
     {"id":"overall","label":"Overall result","type":"select","options":["Pass","Pass with observations","Fail"],"required":true},
     {"id":"observations","label":"Observations","type":"textarea"},
     {"id":"follow_up","label":"Follow-up required","type":"textarea"}
   ]},
   {"id":"evidence","title":"Photos and sign-off","fields":[
     {"id":"photos","label":"Photos","type":"photos"},
     {"id":"signature","label":"Inspector signature","type":"signature"}
   ]}
 ]'::jsonb),

(null, 'variation', 'Variation report',
 'A change to the agreed scope, priced and put to the client.', true,
 '[
   {"id":"change","title":"The change","fields":[
     {"id":"variation_number","label":"Variation number","type":"text"},
     {"id":"requested_by","label":"Requested by","type":"text","required":true},
     {"id":"date_requested","label":"Date requested","type":"date"},
     {"id":"description","label":"Description of change","type":"textarea","required":true},
     {"id":"reason","label":"Reason for change","type":"textarea"}
   ]},
   {"id":"impact","title":"Impact","fields":[
     {"id":"cost_impact","label":"Cost impact (ex GST)","type":"number","required":true},
     {"id":"time_impact_days","label":"Program impact (days)","type":"number"},
     {"id":"scope_impact","label":"Effect on scope","type":"textarea"},
     {"id":"approval","label":"Client approval","type":"select","options":["Pending","Approved","Rejected"]}
   ]},
   {"id":"evidence","title":"Photos and sign-off","fields":[
     {"id":"photos","label":"Supporting photos","type":"photos"},
     {"id":"signature","label":"Approved by","type":"signature"}
   ]}
 ]'::jsonb),

(null, 'security_incident', 'Security incident report',
 'An incident on a guarded site: what happened, who was involved, what was done.', true,
 '[
   {"id":"incident","title":"Incident","fields":[
     {"id":"incident_datetime","label":"Date and time","type":"text","required":true},
     {"id":"location","label":"Location","type":"text","required":true},
     {"id":"incident_type","label":"Type","type":"select","options":["Trespass","Theft","Vandalism","Assault","Alarm activation","Suspicious behaviour","Medical","Fire","Other"],"required":true},
     {"id":"description","label":"What happened","type":"textarea","required":true},
     {"id":"persons_involved","label":"Persons involved","type":"textarea"},
     {"id":"witnesses","label":"Witnesses","type":"textarea"}
   ]},
   {"id":"response","title":"Response","fields":[
     {"id":"action_taken","label":"Action taken","type":"textarea","required":true},
     {"id":"police_called","label":"Police attended","type":"checkbox"},
     {"id":"police_event_number","label":"Police event number","type":"text"},
     {"id":"client_notified","label":"Client notified","type":"checkbox"},
     {"id":"damage","label":"Damage or loss","type":"textarea"},
     {"id":"follow_up","label":"Follow-up required","type":"textarea"}
   ]},
   {"id":"evidence","title":"Evidence and sign-off","fields":[
     {"id":"photos","label":"Photos","type":"photos"},
     {"id":"signature","label":"Officer","type":"signature"}
   ]}
 ]'::jsonb),

(null, 'patrol', 'Patrol report',
 'A completed patrol: rounds, checks, findings.', true,
 '[
   {"id":"patrol","title":"Patrol","fields":[
     {"id":"officer","label":"Officer","type":"text","required":true},
     {"id":"start_time","label":"Patrol start","type":"time","required":true},
     {"id":"finish_time","label":"Patrol finish","type":"time","required":true},
     {"id":"rounds","label":"Number of rounds","type":"number"},
     {"id":"vehicle","label":"Vehicle or on foot","type":"text"}
   ]},
   {"id":"checks","title":"Checks","fields":[
     {"id":"checkpoints","label":"Checkpoints","type":"table","help":"Checkpoint, time, condition"},
     {"id":"doors_secure","label":"All doors and gates secure","type":"checkbox"},
     {"id":"lighting","label":"Lighting operational","type":"checkbox"},
     {"id":"alarms","label":"Alarm systems armed","type":"checkbox"},
     {"id":"findings","label":"Findings and anomalies","type":"textarea"},
     {"id":"action_taken","label":"Action taken","type":"textarea"}
   ]},
   {"id":"evidence","title":"Photos and sign-off","fields":[
     {"id":"photos","label":"Photos","type":"photos"},
     {"id":"signature","label":"Officer signature","type":"signature"}
   ]}
 ]'::jsonb),

(null, 'maintenance', 'Maintenance report',
 'Scheduled or reactive maintenance carried out on an asset.', true,
 '[
   {"id":"asset","title":"Asset","fields":[
     {"id":"asset_name","label":"Asset or system","type":"text","required":true},
     {"id":"asset_id","label":"Asset ID or serial","type":"text"},
     {"id":"location","label":"Location","type":"text"},
     {"id":"maintenance_type","label":"Type","type":"select","options":["Scheduled","Reactive","Breakdown","Compliance"],"required":true}
   ]},
   {"id":"work","title":"Work carried out","fields":[
     {"id":"fault_reported","label":"Fault reported","type":"textarea"},
     {"id":"work_carried_out","label":"Work carried out","type":"textarea","required":true},
     {"id":"parts_used","label":"Parts used","type":"textarea"},
     {"id":"time_on_site","label":"Time on site (hours)","type":"number"},
     {"id":"asset_status","label":"Asset left","type":"select","options":["Operational","Operational with limitations","Out of service"],"required":true},
     {"id":"recommendations","label":"Recommendations","type":"textarea"},
     {"id":"next_service_due","label":"Next service due","type":"date"}
   ]},
   {"id":"evidence","title":"Photos and sign-off","fields":[
     {"id":"photos","label":"Photos","type":"photos"},
     {"id":"signature","label":"Technician","type":"signature"}
   ]}
 ]'::jsonb),

(null, 'service', 'Service report',
 'A service call attendance, for the customer to sign on the spot.', true,
 '[
   {"id":"call","title":"Service call","fields":[
     {"id":"attended_at","label":"Attended","type":"text","required":true},
     {"id":"technician","label":"Technician","type":"text","required":true},
     {"id":"reported_issue","label":"Reported issue","type":"textarea","required":true},
     {"id":"diagnosis","label":"Diagnosis","type":"textarea"}
   ]},
   {"id":"outcome","title":"Outcome","fields":[
     {"id":"work_performed","label":"Work performed","type":"textarea","required":true},
     {"id":"parts_used","label":"Parts and materials","type":"textarea"},
     {"id":"labour_hours","label":"Labour hours","type":"number"},
     {"id":"resolved","label":"Issue resolved","type":"select","options":["Resolved","Temporary fix — return required","Not resolved — quote to follow"],"required":true},
     {"id":"return_required","label":"Return visit required for","type":"textarea"},
     {"id":"customer_advised","label":"Customer advised of","type":"textarea"}
   ]},
   {"id":"evidence","title":"Photos and sign-off","fields":[
     {"id":"photos","label":"Photos","type":"photos"},
     {"id":"signature","label":"Customer signature","type":"signature"}
   ]}
 ]'::jsonb),

(null, 'handover', 'Handover report',
 'Practical completion: what is being handed over and what comes with it.', true,
 '[
   {"id":"handover","title":"Handover","fields":[
     {"id":"handover_date","label":"Handover date","type":"date","required":true},
     {"id":"scope_delivered","label":"Scope delivered","type":"textarea","required":true},
     {"id":"exclusions","label":"Exclusions and incomplete items","type":"textarea"},
     {"id":"outstanding_defects","label":"Outstanding defects","type":"textarea"}
   ]},
   {"id":"documents","title":"Documentation","fields":[
     {"id":"warranties","label":"Warranties provided","type":"textarea"},
     {"id":"manuals","label":"Manuals and certificates","type":"textarea"},
     {"id":"compliance_certificates","label":"Compliance certificates","type":"textarea"},
     {"id":"keys_handed_over","label":"Keys and access handed over","type":"textarea"},
     {"id":"defects_liability_months","label":"Defects liability period (months)","type":"number"},
     {"id":"maintenance_notes","label":"Maintenance requirements","type":"textarea"}
   ]},
   {"id":"evidence","title":"Photos and sign-off","fields":[
     {"id":"photos","label":"Completion photos","type":"photos"},
     {"id":"signature","label":"Accepted by","type":"signature"}
   ]}
 ]'::jsonb)

on conflict (key) where business_id is null
do update set
  name = excluded.name,
  description = excluded.description,
  sections = excluded.sections,
  updated_at = now();
