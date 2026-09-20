import { reply } from '../utils.js';

// .ai / .Ai apa pun isinya -> balasan tetap.
export default async function ai(sock, m) {
  await reply(sock, m, '*bikin sendiri cik lu pikir gampang buat ginian @alyz* 🗿');
}
