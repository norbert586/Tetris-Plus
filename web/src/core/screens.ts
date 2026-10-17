// screen_dispatch's table (0x800942F8): one function per screen, run for the current player.
import { NotPorted, type Game } from './game';
import { scr00Menu } from './screens/menu';
import { scr01Map } from './screens/map';
import { scr02Story } from './screens/story';
import { scr08Idle } from './screens/idle';
import { scr03StageSetup, scr04StageIntro, scr05Play } from './screens/stage';
import { scr06Continue, scr07RankEntry, scr09StageClear, scr13Save } from './screens/after';
import { scr12Pause } from './screens/pausemenu';

const notPorted = (n: number) => (_g: Game) => {
  throw new NotPorted(`screen ${n}`);
};

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
  notPorted(10),
  notPorted(11),
  scr12Pause,
  scr13Save,
];
