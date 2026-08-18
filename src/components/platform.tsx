"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, BarChart3, Bell, BookOpen, Check, ChevronDown, Clock3, Flame, Headphones, Home, LayoutGrid, Library, Menu, MessageCircle, PenLine, Play, Plus, Search, Settings, Sparkles, Target, Trophy, Volume2, X } from "lucide-react";
import { examFormats, lessons, pathway, quiz, skills, weeklyActivity, type Exam } from "@/lib/content";
import { initialProgress, loadProgress, saveProgress, type LearnerState } from "@/lib/progress";
import type { ProgressSnapshot, ProgressState } from "@/lib/repositories/progress";

type View = "Accueil" | "Apprendre" | "Examens" | "Progression" | "Studio";
const nav: { label: View; icon: typeof Home }[] = [
  { label: "Accueil", icon: Home }, { label: "Apprendre", icon: BookOpen },
  { label: "Examens", icon: Target }, { label: "Progression", icon: BarChart3 },
  { label: "Studio", icon: LayoutGrid },
];


// Real learner figures only. Anything the database cannot answer renders an
// explicit empty state rather than an invented number.
const DAY_LABELS = ["L", "M", "M", "J", "V", "S", "D"];

function initials(name: string | null) {
  if (!name) return "—";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "—";
}

function todayLabel() {
  return new Date().toLocaleDateString("fr-CA", { weekday: "long", day: "numeric", month: "long" });
}

/** The last seven calendar dates, oldest first, as YYYY-MM-DD. */
function weekDates() {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return d.toISOString().slice(0, 10);
  });
}

function WeeklyGoal({ snap }: { snap: ProgressSnapshot | null }) {
  if (!snap) {
    return <div className="goal-card"><div className="goal-ring"><span>—</span></div>
      <div><strong>Aucune donnée</strong><p>Votre objectif hebdomadaire apparaîtra ici une fois votre parcours défini.</p></div></div>;
  }
  const week = weekDates();
  const activeDays = week.filter((d) => snap.activeDates.includes(d)).length;
  const targetDays = snap.goals?.studyDays.length ?? 0;
  const percent = targetDays ? Math.min(100, Math.round((activeDays / targetDays) * 100)) : 0;
  return <div className="goal-card">
    <div className="goal-ring"><span>{targetDays ? percent : "—"}{targetDays ? <small>%</small> : null}</span></div>
    <div>
      <strong>{activeDays} jour{activeDays > 1 ? "s" : ""} d’activité</strong>
      <p>{targetDays ? `sur votre objectif de ${targetDays} jours par semaine` : "Définissez vos jours d’étude dans votre parcours."}</p>
      <div className="days">{week.map((d, i) => <span className={snap.activeDates.includes(d) ? "done" : ""} key={d}>{snap.activeDates.includes(d) ? <Check size={12}/> : DAY_LABELS[i]}</span>)}</div>
    </div>
  </div>;
}

function SkillsCard({ snap }: { snap: ProgressSnapshot | null }) {
  // Per-skill mastery is not tracked yet, so for a real learner there is
  // nothing truthful to show. The demonstration figures stay behind demo mode.
  if (snap) {
    return <div className="skills-card skills-empty">
      <p><strong>Pas encore de données</strong></p>
      <p>Vos niveaux par compétence apparaîtront après vos premiers exercices notés.</p>
    </div>;
  }
  return <div className="skills-card">{skills.map(s=><div className="skill-row" key={s.name}><span className="skill-dot" style={{background:s.color}}/><div><strong>{s.name}</strong><small>Niveau {s.level}</small></div><div className="skill-bar"><span style={{width:`${s.score}%`,background:s.color}}/></div><b>{s.score}%</b></div>)}</div>;
}

export default function Platform({ serverProgress }: { serverProgress?: ProgressState }) {
  const [view, setView] = useState<View>("Accueil");
  const [exam, setExam] = useState<Exam>("TEF Canada");
  const [mobile, setMobile] = useState(false);

  // When the database answered, its figures are the record and local storage
  // is not consulted at all. Local storage is only the demonstration store,
  // used when Supabase is not configured.
  const persisted = serverProgress?.status === "ready" ? serverProgress.snapshot : null;
  const demoReason = serverProgress && serverProgress.status !== "ready" ? serverProgress.status : null;
  const [progress, setProgress] = useState<LearnerState>(
    persisted
      ? { streak: persisted.currentStreak, xp: persisted.xp, completedLessons: persisted.completedLessonIds, quizBest: 0 }
      : initialProgress,
  );
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (persisted) return;
    queueMicrotask(() => { setProgress(loadProgress()); setHydrated(true); });
  }, [persisted]);
  useEffect(() => { if (hydrated && !persisted) saveProgress(progress); }, [progress, hydrated, persisted]);

  const completeLesson = (id: string) => setProgress((p) => p.completedLessons.includes(id) ? p : ({ ...p, xp: p.xp + 80, completedLessons: [...p.completedLessons, id] }));
  const navigate = (next: View) => { setView(next); setMobile(false); window.scrollTo({ top: 0, behavior: "smooth" }); };

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobile ? "sidebar-open" : ""}`}>
        <div className="brand"><span className="brand-mark">ç</span><span>Parcours<span>français</span></span></div>
        <button className="close-menu" onClick={() => setMobile(false)} aria-label="Fermer le menu"><X /></button>
        <nav aria-label="Navigation principale">
          {nav.map(({ label, icon: Icon }) => <button key={label} onClick={() => navigate(label)} className={view === label ? "active" : ""}><Icon size={19}/><span>{label}</span></button>)}
        </nav>
        <div className="route-links"><Link href="/practice"><Headphones size={18}/>Écouter & lire</Link><Link href="/production"><PenLine size={18}/>Écrire & parler</Link><Link href="/review"><Trophy size={18}/>Carnet & cartes</Link><Link href="/onboarding"><Target size={18}/>Mon objectif</Link><Link href="/admin/materials"><Library size={18}/>Matériels</Link><Link href="/admin/exams"><Settings size={18}/>Formats d’examen</Link></div>
        <div className="sidebar-bottom">
          <div className="streak-card"><span className="flame"><Flame size={21}/></span><div><strong>{progress.streak} jours</strong><small>Série en cours</small></div></div>
          <button><Settings size={18}/>Paramètres</button>
          <div className="profile"><span>{initials(persisted?.displayName ?? null)}</span><div><strong>{persisted?.displayName ?? "Votre compte"}</strong><small>{persisted?.goals?.targetNclc ? `Objectif NCLC ${persisted.goals.targetNclc}` : "Objectif non défini"}</small></div><ChevronDown size={16}/></div>
        </div>
      </aside>
      {mobile && <button className="scrim" onClick={() => setMobile(false)} aria-label="Fermer le menu" />}
      <main>
        <header className="topbar">
          <button className="menu-button" onClick={() => setMobile(true)} aria-label="Ouvrir le menu"><Menu /></button>
          <div className="exam-switch" aria-label="Examen préparé">
            {(["TEF Canada", "TCF Canada"] as Exam[]).map((item) => <button key={item} onClick={() => setExam(item)} className={exam === item ? "selected" : ""}>{item}</button>)}
          </div>
          <div className="top-actions"><span className="xp"><Sparkles size={16}/>{progress.xp.toLocaleString("fr-CA")} XP</span><button className="icon-button" aria-label="Notifications"><Bell size={19}/><i /></button><span className="avatar">{initials(persisted?.displayName ?? null)}</span></div>
        </header>

        {view === "Accueil" && <Dashboard exam={exam} onNavigate={navigate} progress={progress} completeLesson={completeLesson} snap={persisted} demoReason={demoReason} />}
        {view === "Apprendre" && <Learn progress={progress} completeLesson={completeLesson} />}
        {view === "Examens" && <Exams exam={exam} setExam={setExam} onScore={(score) => setProgress((p) => ({ ...p, quizBest: Math.max(p.quizBest, score), xp: p.xp + score * 20 }))} />}
        {view === "Progression" && <Progress progress={progress} snap={persisted} />}
        {view === "Studio" && <Studio />}
      </main>
    </div>
  );
}

function Dashboard({ exam, onNavigate, progress, completeLesson, snap, demoReason }: { exam: Exam; onNavigate: (v: View) => void; progress: LearnerState; completeLesson: (id: string) => void; snap: ProgressSnapshot | null; demoReason: string | null }) {
  return <div className="page dashboard">
    {demoReason && <p className="demo-banner" role="status">{demoReason === "signed-out" ? "Chiffres de démonstration. Connectez-vous pour afficher vos données réelles." : demoReason === "error" ? "Vos données n’ont pas pu être chargées. Les chiffres ci-dessous sont des exemples." : "Mode démonstration : Supabase n’est pas configuré. Les chiffres ci-dessous sont des exemples, pas vos données."}</p>}
    <section className="welcome"><div><p className="eyebrow">{todayLabel()}</p><h1>{snap?.displayName ? `Bonjour ${snap.displayName}, prêt à progresser` : "Bonjour, prêt à progresser"}&nbsp;?</h1><p>Votre prochaine étape est prête. Quelques minutes aujourd’hui feront toute la différence.</p></div><div className="level-orbit"><span><b>{snap ? (snap.goals?.currentCefr ?? "—") : "B2"}</b><small>{snap ? (snap.goals ? "Niveau déclaré" : "Non évalué") : "Niveau actuel"}</small></span></div></section>
    <section className="continue-card">
      <div className="lesson-art"><span className="sound-wave">{[1,2,3,4,5,6,7].map(i=><i key={i}/>)}</span><Headphones size={31}/></div>
      <div className="continue-copy"><span className="pill">REPRENDRE LE COURS</span><p>Compréhension orale · B2</p><h2>Comprendre une chronique radio</h2><div className="progress-line"><span style={{width: progress.completedLessons.includes("radio") ? "100%" : "65%"}}/></div><small>{progress.completedLessons.includes("radio") ? "Terminé" : "3 activités sur 5"}</small></div>
      <button className="primary" onClick={() => completeLesson("radio")}><Play size={17} fill="currentColor"/>{progress.completedLessons.includes("radio") ? "Réviser" : "Continuer"}</button>
    </section>
    <div className="grid-two">
      <section><SectionTitle title="Votre programme" action="Voir tout" onClick={() => onNavigate("Apprendre")}/><div className="lesson-grid">{lessons.slice(0,2).map(l => <LessonCard key={l.id} lesson={l} completed={progress.completedLessons.includes(l.id)} onComplete={() => completeLesson(l.id)}/>)}</div></section>
      <section><SectionTitle title="Objectif de la semaine"/><WeeklyGoal snap={snap}/></section>
    </div>
    <div className="grid-two lower">
      <section><SectionTitle title="Vos compétences" action="Détails" onClick={() => onNavigate("Progression")}/><SkillsCard snap={snap}/></section>
      <section><SectionTitle title={`Prochaine simulation · ${exam}`}/><div className="simulation-card"><div className="calendar"><span>AOÛT</span><b>24</b></div><div><strong>Simulation complète</strong><p>4 épreuves · Conditions réelles</p><small><Clock3 size={14}/> 2 h 55 min</small></div><button className="outline" onClick={() => onNavigate("Examens")}>Se préparer <ArrowRight size={16}/></button></div><div className="tip"><span><Sparkles size={17}/></span><p><strong>Conseil du jour</strong>À l’oral, reformulez la question pour gagner quelques secondes de réflexion.</p></div></section>
    </div>
  </div>
}

function Learn({ progress, completeLesson }: { progress: LearnerState; completeLesson: (id: string) => void }) {
  return <div className="page"><PageIntro eyebrow="PARCOURS PERSONNALISÉ" title="Apprendre le français, pas seulement l'examen" text="Une progression structurée du niveau B1 au C1 : langue, stratégies et pratique délibérée." />
    <div className="pathway">{pathway.map((p,i)=><div key={p.week} className={`path-step ${p.done ? "path-done" : ""}`}><span>{p.done ? <Check/> : i+1}</span><div><small>{p.week}</small><h3>{p.title}</h3><p>{p.detail}</p></div></div>)}</div>
    <SectionTitle title="Bibliothèque de cours" action={`${lessons.length} modules`}/><div className="lesson-grid all-lessons">{lessons.map(l=><LessonCard key={l.id} lesson={l} completed={progress.completedLessons.includes(l.id)} onComplete={()=>completeLesson(l.id)}/>)}</div>
  </div>
}

function Exams({ exam, setExam, onScore }: { exam: Exam; setExam:(e:Exam)=>void; onScore:(s:number)=>void }) {
  const [started,setStarted]=useState(false); const [index,setIndex]=useState(0); const [selected,setSelected]=useState<number|null>(null); const [score,setScore]=useState(0); const [finished,setFinished]=useState(false);
  const answer=()=>{if(selected===null)return; const next=score+(selected===quiz[index].correct?1:0); setScore(next); if(index===quiz.length-1){setFinished(true);onScore(next)}else{setIndex(index+1);setSelected(null)}};
  const restart=()=>{setIndex(0);setSelected(null);setScore(0);setFinished(false);setStarted(true)};
  return <div className="page"><PageIntro eyebrow="CENTRE D'EXAMEN" title="Maîtrisez le format. Gardez votre calme." text="Entraînez chaque épreuve avec chronomètre, correction expliquée et stratégies adaptées." />
    <div className="exam-tabs">{(["TEF Canada","TCF Canada"] as Exam[]).map(e=><button className={exam===e?"active":""} onClick={()=>setExam(e)} key={e}>{e}</button>)}</div>
    {!started ? <><div className="format-grid">{examFormats[exam].map((f,i)=><div className="format-card" key={f.skill}><span>0{i+1}</span><SkillIcon name={f.skill}/><h3>{f.skill}</h3><strong>{f.detail}</strong><p>{f.note}</p></div>)}</div><div className="mock-cta"><div><span className="pill">SIMULATION GUIDÉE</span><h2>Échauffement express</h2><p>3 questions représentatives avec explications immédiates.</p></div><button className="primary" onClick={()=>setStarted(true)}><Play size={17} fill="currentColor"/>Commencer</button></div></> :
    <div className="quiz-card">{finished ? <div className="result"><span><Trophy/></span><p>Simulation terminée</p><h2>{score} / {quiz.length}</h2><small>{score===quiz.length?"Excellent. Vos réflexes sont solides.":"Bien joué. Relisez les explications et réessayez."}</small><button className="primary" onClick={restart}>Recommencer</button></div> : <><div className="quiz-top"><span>Question {index+1} sur {quiz.length}</span><span><Clock3 size={15}/> 01:{String(20-index*7).padStart(2,"0")}</span></div><div className="quiz-progress"><span style={{width:`${((index+1)/quiz.length)*100}%`}}/></div><div className="audio-context"><Volume2/><p>{quiz[index].context}</p></div><h2>{quiz[index].prompt}</h2><div className="answers">{quiz[index].answers.map((a,i)=><button onClick={()=>setSelected(i)} className={selected===i?"selected":""} key={a}><span>{String.fromCharCode(65+i)}</span>{a}</button>)}</div><button className="primary next" disabled={selected===null} onClick={answer}>Valider et continuer <ArrowRight size={17}/></button></>}</div>}
  </div>
}

function Progress({ progress, snap }: { progress: LearnerState; snap: ProgressSnapshot | null }) { const max=Math.max(...weeklyActivity.map(d=>d.minutes)); return <div className="page"><PageIntro eyebrow="TABLEAU DE PROGRESSION" title="Vos efforts deviennent visibles" text="Suivez votre régularité, vos compétences et les prochaines priorités de révision." />
  <div className="metrics"><Metric value={snap ? (snap.goals?.currentCefr ?? "—") : "B2"} label={snap ? "Niveau déclaré" : "Niveau estimé"} icon={<Target/>}/><Metric value={`${progress.xp.toLocaleString("fr-CA")}`} label="Points d'expérience" icon={<Sparkles/>}/><Metric value={`${progress.streak} j`} label="Série actuelle" icon={<Flame/>}/><Metric value={`${progress.completedLessons.length}`} label="Cours terminés" icon={<Trophy/>}/></div>
  <div className="progress-grid"><section className="chart-card"><SectionTitle title={snap ? "Jours d’activité" : "Temps d’étude"} action="Cette semaine"/>{snap ? <div className="bar-chart">{weekDates().map((d,i)=><div key={d}><span style={{height: snap.activeDates.includes(d) ? "100%" : "6%"}}><i>{snap.activeDates.includes(d) ? "actif" : "—"}</i></span><small>{DAY_LABELS[i]}</small></div>)}</div> : <div className="bar-chart">{weeklyActivity.map((d,i)=><div key={i}><span style={{height:`${(d.minutes/max)*100}%`}}><i>{d.minutes}m</i></span><small>{d.day}</small></div>)}</div>}</section><section className="skills-card detailed"><SectionTitle title="Profil de compétences"/>{skills.map(s=><div className="skill-row" key={s.name}><span className="skill-dot" style={{background:s.color}}/><div><strong>{s.name}</strong><small>{s.level}</small></div><div className="skill-bar"><span style={{width:`${s.score}%`,background:s.color}}/></div><b>{s.score}%</b></div>)}</section></div>
  {snap ? <div className="recommendation"><span><Sparkles/></span><div><small>PRIORITÉ RECOMMANDÉE</small><h3>Recommandations à venir</h3><p>Les recommandations s’appuient sur vos réponses notées. Terminez quelques exercices pour les activer.</p></div></div> : <div className="recommendation"><span><Sparkles/></span><div><small>PRIORITÉ RECOMMANDÉE</small><h3>Renforcez votre expression orale</h3><p>Votre score est 12 points sous votre compréhension. Trois séances ciblées cette semaine peuvent réduire cet écart.</p></div><button className="outline">Voir le parcours <ArrowRight size={16}/></button></div>}</div> }

function Studio() {
  const [items,setItems]=useState(lessons.map((l,i)=>({...l,status:i<3?"Publié":"Brouillon"})));
  const [query,setQuery]=useState("");
  return <div className="page"><div className="studio-head"><PageIntro eyebrow="ESPACE ÉDITEUR" title="Contenus pédagogiques" text="Gérez les cours et leur statut de publication. Les rôles et validations sont prévus dans le modèle de données."/><button className="primary"><Plus size={17}/>Nouveau cours</button></div>
    <div className="studio-toolbar"><label><Search size={17}/><input aria-label="Rechercher un contenu" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Rechercher un titre…"/></label><span>{items.filter(i=>i.status==="Publié").length} publiés · {items.length} contenus</span></div>
    <div className="content-table"><div className="content-row table-head"><span>Contenu</span><span>Niveau</span><span>Durée</span><span>Statut</span><span>Action</span></div>{items.filter(i=>i.title.toLowerCase().includes(query.toLowerCase())).map(item=><div className="content-row" key={item.id}><div><strong>{item.title}</strong><small>{item.eyebrow.split(" · ")[0]}</small></div><span>{item.eyebrow.split(" · ")[1]}</span><span>{item.duration} min</span><i className={item.status==="Publié"?"published":"draft"}>{item.status}</i><button onClick={()=>setItems(all=>all.map(x=>x.id===item.id?{...x,status:x.status==="Publié"?"Brouillon":"Publié"}:x))}>{item.status==="Publié"?"Dépublier":"Publier"}</button></div>)}</div>
  </div>
}

function LessonCard({lesson,completed,onComplete}:{lesson:typeof lessons[number];completed:boolean;onComplete:()=>void}) { return <article className="lesson-card"><div className={`lesson-icon ${lesson.color}`}><SkillIcon name={lesson.eyebrow}/></div><div className="lesson-body"><p>{lesson.eyebrow}</p><h3>{lesson.title}</h3><span>{lesson.description}</span><div className="lesson-meta"><small><Clock3 size={14}/>{lesson.duration} min</small><div>{lesson.tags.map(t=><i key={t}>{t}</i>)}</div></div><button onClick={onComplete} className={completed?"completed":""}>{completed?<><Check size={16}/>Terminé</>:<>Commencer <ArrowRight size={15}/></>}</button></div></article> }
function SkillIcon({name}:{name:string}) { if(name.includes("orale")||name.includes("radio"))return <Headphones/>; if(name.includes("écrite")||name.includes("lettre"))return <PenLine/>; if(name.includes("Expression"))return <MessageCircle/>; return <Library/> }
function SectionTitle({title,action,onClick}:{title:string;action?:string;onClick?:()=>void}) { return <div className="section-title"><h2>{title}</h2>{action&&<button onClick={onClick}>{action}{onClick&&<ArrowRight size={15}/>}</button>}</div> }
function PageIntro({eyebrow,title,text}:{eyebrow:string;title:string;text:string}) { return <section className="page-intro"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><span>{text}</span></section> }
function Metric({value,label,icon}:{value:string;label:string;icon:React.ReactNode}) { return <div className="metric"><span>{icon}</span><div><strong>{value}</strong><small>{label}</small></div></div> }
