export type SourceReference={sourceId:string;sourceVersion:number;page:number;evidence:string};
export type AIRequest={task:"writing_feedback"|"speaking_feedback"|"draft_lesson"|"draft_questions"|"study_plan";input:string;locale:"fr"|"en"|"fa";sources?:SourceReference[];promptVersion:string};
export type AIResult={status:"draft";content:unknown;citations:SourceReference[];provider:string;model:string;promptVersion:string};
export interface AIProvider{readonly name:string;isConfigured():boolean;generate(request:AIRequest):Promise<AIResult>}
export class ProviderNotConfiguredError extends Error{constructor(feature:string){super(`${feature} nécessite un fournisseur configuré. Le reste de la plateforme demeure disponible.`);this.name="ProviderNotConfiguredError"}}
