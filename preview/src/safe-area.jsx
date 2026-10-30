import React from "react";
import { View } from "react-native-web";
// Browser preview only; native safe areas require device acceptance.
export const SafeAreaProvider = ({children}) => <>{children}</>;
export const SafeAreaView = View;
export const initialWindowMetrics = null;
export const useSafeAreaInsets = () => ({top:0,right:0,bottom:0,left:0});
