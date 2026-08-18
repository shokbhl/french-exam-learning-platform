import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest { return { name:"Parcours français", short_name:"Parcours", description:"Apprentissage du français et préparation TEF/TCF Canada", start_url:"/", display:"standalone", background_color:"#f6f4ed", theme_color:"#173e35", lang:"fr", icons:[{src:"/icon.svg",sizes:"any",type:"image/svg+xml"}] }; }
