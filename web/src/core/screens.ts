// screen_dispatch's table (0x800942F8): one function per screen, run for the current player.
import { NotPorted, type Game } from './game';
import { scr00Menu } from './screens/menu';
import { scr01Map } from './screens/map';
import { scr02Story } from './screens/story';
import { scr08Idle } from './screens/idle';

const notPorted = (n: number) => (_g: Game) => {
  throw new NotPorted(`screen ${n}`);
};

export const SCREENS: ((g: Game) => void)[] = [
  scr00Menu,
  scr01Map,
  scr02Story,
  notPorted(3),
  notPorted(4),
  notPorted(5),
  notPorted(6),
  notPorted(7),
  scr08Idle,
  notPorted(9),
  notPorted(10),
  notPorted(11),
  notPorted(12),
  notPorted(13),
];
