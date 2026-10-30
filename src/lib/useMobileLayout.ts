import { useEffect, useState } from "react";
import { IS_WEB } from "./platform";

export const MOBILE_QUERY = "(max-width: 767px), (pointer: coarse) and (max-width: 1100px)";
export function useMobileLayout() {
  const [mobile, setMobile] = useState(() => IS_WEB && matchMedia(MOBILE_QUERY).matches);
  useEffect(() => {
    const query = matchMedia(MOBILE_QUERY);
    const update = () => setMobile(IS_WEB && query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return mobile;
}
