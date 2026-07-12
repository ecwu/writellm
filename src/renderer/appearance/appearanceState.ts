import { defaultAppearancePreferences, type AppearancePreferences, type GetAppearanceResult, type ThemeMode, type UpdateAppearanceResult } from '../../shared/appearance';
export type AppearanceState={preferences:AppearancePreferences;pending:boolean;message?:string}; export const initialAppearanceState:AppearanceState={preferences:defaultAppearancePreferences,pending:false};
export function effectiveTheme(mode:ThemeMode,systemDark:boolean):'light'|'dark'{return mode==='system'?(systemDark?'dark':'light'):mode}
export function loadedAppearance(result:GetAppearanceResult):AppearanceState{return {preferences:result.preferences,pending:false,message:result.warning?.message}}
export function completedUpdate(previous:AppearanceState,result:UpdateAppearanceResult):AppearanceState{return result.status==='updated'?{preferences:result.preferences,pending:false}:{...previous,pending:false,message:result.error.message}}
