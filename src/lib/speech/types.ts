export type SpeechInput={audio:Uint8Array;mimeType:string;language:string};
export interface SpeechToTextProvider{isConfigured():boolean;transcribe(input:SpeechInput):Promise<{text:string;segments:{start:number;end:number;text:string}[]}>}
export interface TextToSpeechProvider{isConfigured():boolean;synthesize(input:{text:string;voice?:string;language:string}):Promise<{audio:Uint8Array;mimeType:string}>}
