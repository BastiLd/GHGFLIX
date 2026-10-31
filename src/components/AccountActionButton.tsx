import {useRef,useState,type ButtonHTMLAttributes} from 'react';
import {ArrowRight} from 'lucide-react';
import './account-actions.css';

export function AccountActionButton({children,onClick,onPointerDown,className='',primary=false,type='button',...props}:ButtonHTMLAttributes<HTMLButtonElement>&{primary?:boolean}) {
  const sequence=useRef(0);
  const [ripple,setRipple]=useState<{id:number;x:number;y:number;size:number}|null>(null);
  const pulse=(target:HTMLButtonElement,x?:number,y?:number)=>{
    const rect=target.getBoundingClientRect();
    setRipple({id:++sequence.current,x:x===undefined?rect.width/2:x-rect.left,y:y===undefined?rect.height/2:y-rect.top,size:2*Math.hypot(rect.width,rect.height)});
  };
  return <button {...props} type={type} className={`account-action ${primary?'account-action--primary':''} ${className}`} onPointerDown={event=>{
    if(event.button===0&&!props.disabled)pulse(event.currentTarget,event.clientX,event.clientY);
    onPointerDown?.(event);
  }} onClick={event=>{
    if(event.detail===0)pulse(event.currentTarget);
    onClick?.(event);
  }}>
    {ripple&&<span key={ripple.id} aria-hidden="true" className="account-action__ripple" style={{left:ripple.x,top:ripple.y,width:ripple.size,height:ripple.size}} onAnimationEnd={()=>setRipple(null)}/>}
    <span className="account-action__label">{children}</span>
    <ArrowRight aria-hidden="true" size={17} className="account-action__arrow"/>
  </button>;
}
