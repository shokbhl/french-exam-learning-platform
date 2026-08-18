export type Skill = "Compréhension orale" | "Compréhension écrite" | "Expression orale" | "Expression écrite";
export type Exam = "TEF Canada" | "TCF Canada";

export const weeklyActivity = [
  { day: "L", minutes: 24 }, { day: "M", minutes: 38 }, { day: "M", minutes: 30 },
  { day: "J", minutes: 46 }, { day: "V", minutes: 18 }, { day: "S", minutes: 34 }, { day: "D", minutes: 12 },
];

export const skills: { name: Skill; level: string; score: number; color: string }[] = [
  { name: "Compréhension orale", level: "B2", score: 74, color: "#e8553f" },
  { name: "Compréhension écrite", level: "B2", score: 81, color: "#2b7a67" },
  { name: "Expression orale", level: "B1", score: 62, color: "#d99a26" },
  { name: "Expression écrite", level: "B2", score: 70, color: "#6474b9" },
];

export const lessons = [
  { id: "argumenter", eyebrow: "Expression orale · B2", title: "Défendre un point de vue", description: "Structurez une réponse convaincante avec des connecteurs naturels.", duration: 18, progress: 65, icon: "message", color: "coral", tags: ["TEF", "TCF"] },
  { id: "radio", eyebrow: "Compréhension orale · B2", title: "Comprendre une chronique radio", description: "Repérez l'opinion, le ton et les informations implicites.", duration: 22, progress: 20, icon: "headphones", color: "sage", tags: ["TEF", "TCF"] },
  { id: "conditionnel", eyebrow: "Grammaire · B1", title: "Le conditionnel présent", description: "Formez des hypothèses et exprimez vos souhaits avec précision.", duration: 15, progress: 0, icon: "book", color: "gold", tags: ["Fondamentaux"] },
  { id: "lettre", eyebrow: "Expression écrite · B2", title: "Rédiger une lettre formelle", description: "Adoptez le registre et les formules attendus le jour de l'examen.", duration: 25, progress: 0, icon: "pen", color: "lavender", tags: ["TEF"] },
];

export const examFormats = {
  "TEF Canada": [
    { skill: "Compréhension orale", detail: "40 questions · 40 min", note: "Audio diffusé une seule fois" },
    { skill: "Compréhension écrite", detail: "40 questions · 60 min", note: "Documents de la vie quotidienne" },
    { skill: "Expression orale", detail: "2 sections · 15 min", note: "Obtenir des renseignements, convaincre" },
    { skill: "Expression écrite", detail: "2 sections · 60 min", note: "Suite d'article, argumentation" },
  ],
  "TCF Canada": [
    { skill: "Compréhension orale", detail: "39 questions · 35 min", note: "Difficulté progressive" },
    { skill: "Compréhension écrite", detail: "39 questions · 60 min", note: "Difficulté progressive" },
    { skill: "Expression orale", detail: "3 tâches · 12 min", note: "Entretien individuel" },
    { skill: "Expression écrite", detail: "3 tâches · 60 min", note: "Message, récit, comparaison" },
  ],
} satisfies Record<Exam, { skill: Skill; detail: string; note: string }[]>;

export const quiz = [
  { prompt: "Que souhaite principalement la locutrice ?", context: "« Je vous appelle au sujet de l'annonce pour le studio. Serait-il possible de le visiter samedi matin ? »", answers: ["Négocier le loyer", "Organiser une visite", "Signaler un problème", "Annuler un rendez-vous"], correct: 1, explanation: "La demande centrale est formulée avec « serait-il possible de le visiter »." },
  { prompt: "Quel registre convient à une lettre de réclamation ?", context: "Vous écrivez au responsable d'un service après une livraison incomplète.", answers: ["Familier", "Soutenu et courtois", "Ironique", "Télégraphique"], correct: 1, explanation: "Une réclamation d'examen doit rester formelle, factuelle et courtoise." },
  { prompt: "Complétez : Si j'avais plus de temps, je ___ davantage.", context: "Choisissez la forme qui exprime une hypothèse irréelle au présent.", answers: ["voyagerai", "voyageais", "voyagerais", "avais voyagé"], correct: 2, explanation: "Si + imparfait appelle le conditionnel présent dans la proposition principale." },
];

export const pathway = [
  { week: "Semaine 1", title: "Diagnostic & repères", detail: "Évaluation initiale, format TEF/TCF, objectifs NCLC", done: true },
  { week: "Semaine 2", title: "Comprendre l'essentiel", detail: "Intention, contexte et mots-clés à l'oral", done: true },
  { week: "Semaine 3", title: "Argumenter clairement", detail: "Opinion, justification et exemples", done: false },
  { week: "Semaine 4", title: "Gérer le temps", detail: "Stratégies par section et simulation guidée", done: false },
];
