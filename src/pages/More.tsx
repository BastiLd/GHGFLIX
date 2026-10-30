import { BarChart3, ChevronRight, Heart, Rss, Settings, Share, Smartphone, User } from "lucide-react";
import { Link } from "react-router-dom";
import { useStore } from "../lib/store";
export default function More() {
  const name = useStore(s => s.profileName);
  const installed = matchMedia("(display-mode: standalone)").matches;
  return <div className="mobile-more">
    <p className="mobile-eyebrow">DEIN GHGFLIX</p><h1>Mehr</h1>
    <Link className="mobile-profile" to="/profiles"><User size={28}/><div><strong>{name}</strong><small>Profil wechseln</small></div><ChevronRight size={20}/></Link>
    <div className="mobile-link-list">{[["/list","Meine Liste",Heart],["/settings","Einstellungen",Settings],["/stats","Statistik",BarChart3],["/kanaele","Kanäle",Rss]].map(([to,label,Icon]: any) => <Link to={to} key={to}><Icon size={21}/><span>{label}</span><ChevronRight size={18}/></Link>)}</div>
    {!installed && <section className="mobile-install"><Smartphone size={25}/><h2>GHGFlix auf deinem Home-Bildschirm</h2><p>Öffne diese Adresse in Safari. Tippe auf <Share size={16} className="inline"/> <strong>Teilen</strong> und dann auf <strong>Zum Home-Bildschirm</strong>. Falls angezeigt, lasse „Als Web-App öffnen“ eingeschaltet.</p><p>Im Heimnetz direkt erreichbar. Unterwegs brauchst du die Tailscale-Verbindung zu deinem Server.</p></section>}
  </div>;
}
