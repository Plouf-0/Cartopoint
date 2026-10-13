/**
 * Fenêtre de connexion au mode gestion.
 */
import { $, toast } from '../util.js';
import { S } from '../store.js';
import { checkPassword } from '../auth.js';
import { render } from '../render.js';

export function openLogin() {
  $('#loginMsg').textContent = '';
  $('#dlgLogin').showModal();
  $('#loginPw').focus();
}

export function bindLogin() {
  const dlg = $('#dlgLogin');
  dlg.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => dlg.close()));
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!(await checkPassword($('#loginPw').value, S.project.passwordHash))) {
      $('#loginMsg').textContent = 'Mot de passe incorrect.';
      $('#loginPw').select();
      return;
    }
    dlg.close();
    $('#loginPw').value = '';
    S.admin = true;
    S.ui.placing = null;
    S.ui.tab = 'fiches';
    render();
    toast('Mode gestion');
  });
}
