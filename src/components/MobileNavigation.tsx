import { Film, House, MoreHorizontal, Search, Tv, User } from "lucide-react";
import { NavLink, useNavigate } from "react-router-dom";
import { Wordmark } from "./Brand";
import { useStore } from "../lib/store";

const links = [["/", "Start", House], ["/movies", "Filme", Film], ["/shows", "Serien", Tv], ["/search", "Suche", Search], ["/more", "Mehr", MoreHorizontal]] as const;
export function MobileHeader() {
  const navigate = useNavigate();
  const avatar = useStore(s => s.profileAvatar);
  const name = useStore(s => s.profileName);
  return <header className="mobile-header"><Wordmark /><button aria-label={`Profil wechseln: ${name}`} style={{borderRadius:'50%',...(avatar?{background:'transparent'}:{})}} onClick={() => navigate("/profiles")}>{avatar?<img src={avatar} alt="" style={{width:30,height:30,borderRadius:15,objectFit:"cover"}}/>:<User size={21} />}</button></header>;
}
export function MobileNavigation() {
  return <nav className="mobile-navigation" aria-label="Hauptnavigation">{links.map(([to,label,Icon]) => <NavLink key={to} to={to} end={to === "/"} className={({isActive}) => isActive ? "active" : ""}><Icon size={23} strokeWidth={1.8}/><span>{label}</span></NavLink>)}</nav>;
}
