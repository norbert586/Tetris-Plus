// screen_dispatch's table (0x800942F8): one function per screen, run for the current player.
import type { Game } from './game';
import { scr06Continue, scr07RankEntry, scr09StageClear, scr13Save } from './screens/after';
import { scr10ZoneClear, scr11Ending } from './screens/ending';
import { scr08Idle } from './screens/idle';
import { scr01Map } from './screens/map';
import { scr00Menu } from './screens/menu';
import { scr12Pause } from './screens/pausemenu';
import { scr03StageSetup, scr04StageIntro, scr05Play } from './screens/stage';
import { scr02Story } from './screens/story';

export const SCREENS: ((g: Game) => void)[] = [
  scr00Menu,
  scr01Map,
  scr02Story,
  scr03StageSetup,
  scr04StageIntro,
  scr05Play,
  scr06Continue,
  scr07RankEntry,
  scr08Idle,
  scr09StageClear,
  scr10ZoneClear,
  scr11Ending,
  scr12Pause,
  scr13Save,
];
