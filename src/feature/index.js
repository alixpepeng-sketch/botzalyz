import ai from './ai.js';
import brat from './brat.js';
import fotolive from './fotolive.js';
import kickall from './kickall.js';
import menu from './menu.js';
import removebg from './removebg.js';
import rvo from './rvo.js';
import selfmode, { publicMode, self } from './selfmode.js';
import sticker from './sticker.js';
import toptv from './toptv.js';
import { leave, setleave, setwelcome, welcome } from './welcome.js';

// Kunci = nama perintah huruf kecil tanpa titik. Semua fitur menerima
// (sock, m, args, sessionDir).
export const commands = {
  menu,
  rvo,
  toptv,
  fotolive,
  kickall,
  selfmode,
  self,
  public: publicMode,
  removebg,
  sticker,
  s: sticker,
  brat,
  setwelcome,
  setleave,
  welcome,
  leave,
  ai,
};
