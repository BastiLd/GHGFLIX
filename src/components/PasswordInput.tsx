import {useEffect,useState,type InputHTMLAttributes} from 'react';
import {Eye,EyeOff} from 'lucide-react';

/** Only reveals the value currently typed by the user, never a stored password. */
export function PasswordInput({className='',...props}:Omit<InputHTMLAttributes<HTMLInputElement>,'type'>) {
  const [visible,setVisible]=useState(false);
  useEffect(()=>{if(!props.value)setVisible(false);},[props.value]);
  const label=String(props['aria-label']||'Passwort');
  return <span className="relative block">
    <input {...props} type={visible?'text':'password'} className={`${className} pr-12`}/>
    <button type="button" disabled={props.disabled} aria-label={`${label} ${visible?'verbergen':'anzeigen'}`} aria-pressed={visible}
      onClick={()=>setVisible(v=>!v)} className="absolute right-1 top-1/2 -translate-y-1/2 p-2 text-ghg-muted hover:text-ghg-text">
      {visible?<EyeOff size={18}/>:<Eye size={18}/>}
    </button>
  </span>;
}
