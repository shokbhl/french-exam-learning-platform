-- Original demonstration content written for this project. No third-party exam items are included.
insert into public.exams(id,code,name) values
('10000000-0000-0000-0000-000000000001','TEF_CANADA','TEF Canada'),
('10000000-0000-0000-0000-000000000002','TCF_CANADA','TCF Canada') on conflict do nothing;
insert into public.exam_versions(id,exam_id,version,valid_from,source_url,is_active) values
('11000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','demo-2026.1','2026-01-01','https://www.lefrancaisdesaffaires.fr/',true),
('11000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','demo-2026.1','2026-01-01','https://www.france-education-international.fr/',true) on conflict do nothing;
insert into public.exam_sections(id,exam_version_id,skill,title,position,question_count,duration_seconds,navigation_rules,audio_replay_limit) values
('12000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','LISTENING','Compréhension orale',1,40,2400,'{"back_navigation":false}',1),
('12000000-0000-0000-0000-000000000002','11000000-0000-0000-0000-000000000002','LISTENING','Compréhension orale',1,39,2100,'{"difficulty":"progressive"}',1),
('12000000-0000-0000-0000-000000000003','11000000-0000-0000-0000-000000000001','READING','Compréhension écrite',2,40,3600,'{"back_navigation":true}',null),
('12000000-0000-0000-0000-000000000004','11000000-0000-0000-0000-000000000002','READING','Compréhension écrite',2,39,3600,'{"back_navigation":true}',null) on conflict do nothing;

insert into public.concepts(id,stable_key,kind,title,cefr_level,status,current_version) values
('20000000-0000-0000-0000-000000000001','expressing-an-opinion','communicative_purpose','Exprimer et défendre une opinion','B2','published',1),
('20000000-0000-0000-0000-000000000002','identifying-speaker-intent','listening_strategy','Repérer l’intention du locuteur','B1','published',1) on conflict do nothing;
insert into public.content_versions(concept_id,version,content) values
('20000000-0000-0000-0000-000000000001',1,'{"objective":"Structurer une opinion nuancée","rules":["annoncer sa position","justifier","illustrer","nuancer"],"examples":["À mon sens, cette mesure serait utile, à condition qu’elle reste accessible."]}'),
('20000000-0000-0000-0000-000000000002',1,'{"objective":"Distinguer demande, opinion et information","examples":["Serait-il possible de déplacer notre rendez-vous ?"]}') on conflict do nothing;
insert into public.lessons(id,slug,title,cefr_level,primary_skill,duration_minutes,status,current_version) values
('21000000-0000-0000-0000-000000000001','defendre-un-point-de-vue','Défendre un point de vue','B2','SPEAKING',18,'published',1),
('21000000-0000-0000-0000-000000000002','comprendre-une-chronique','Comprendre une chronique radio','B2','LISTENING',22,'published',1) on conflict do nothing;
insert into public.lesson_versions(lesson_id,version,blocks) values
('21000000-0000-0000-0000-000000000001',1,'[{"type":"diagnostic","prompt":"Donnez votre avis sur le télétravail."},{"type":"explanation","text":"Une réponse convaincante annonce une position, donne une raison précise, puis un exemple."},{"type":"production","prompt":"Convainquez un collègue d’essayer une journée sans voiture."}]'),
('21000000-0000-0000-0000-000000000002',1,'[{"type":"strategy","text":"Avant les options, anticipez qui parle, pourquoi et à qui."},{"type":"summary","text":"Appuyez chaque réponse sur un indice entendu."}]') on conflict do nothing;
insert into public.lesson_concepts(lesson_id,concept_id,position,exam_label) values
('21000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',1,'COMMON'),
('21000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002',1,'COMMON') on conflict do nothing;

insert into public.questions(id,stable_key,skill,status,current_version) values
('30000000-0000-0000-0000-000000000001','demo-listening-visit-intent','LISTENING','published',1),
('30000000-0000-0000-0000-000000000002','demo-reading-library-notice','READING','published',1) on conflict do nothing;
insert into public.question_versions(id,question_id,version,kind,prompt,difficulty,content,correct_answer,explanation,distractor_explanations) values
('31000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',1,'single_choice','Pourquoi la personne téléphone-t-elle ?',2,'{"transcript":"Bonjour, je vous appelle au sujet du studio. Serait-il possible de le visiter samedi matin ?"}','"visit"','La demande explicite est d’organiser une visite.','{"price":"Aucun prix n’est discuté.","cancel":"Aucun rendez-vous n’existe encore."}'),
('31000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000002',1,'single_choice','Que doit faire un usager qui veut travailler après 18 h ?',2,'{"passage":"La bibliothèque ferme à 18 h cette semaine. La salle d’étude du deuxième étage reste accessible avec une carte active jusqu’à 21 h."}','"use-study-room"','La deuxième phrase indique précisément la solution et sa condition.','{"main-library":"La bibliothèque ferme à 18 h.","no-access":"Une salle reste accessible."}') on conflict do nothing;
insert into public.practice_sets(id,title,exam_version_id,mode,status,settings) values
('32000000-0000-0000-0000-000000000001','TEF Canada — démonstration originale','11000000-0000-0000-0000-000000000001','exam','published','{"unofficial_estimate":true}'),
('32000000-0000-0000-0000-000000000002','TCF Canada — démonstration originale','11000000-0000-0000-0000-000000000002','exam','published','{"unofficial_estimate":true}') on conflict do nothing;
insert into public.practice_set_questions(practice_set_id,question_version_id,position) values
('32000000-0000-0000-0000-000000000001','31000000-0000-0000-0000-000000000001',1),
('32000000-0000-0000-0000-000000000002','31000000-0000-0000-0000-000000000002',1) on conflict do nothing;
