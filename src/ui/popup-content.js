import { popupContent } from '../config/popups.js';
import { icon } from './icons.js';
import { applicationName, brandedText } from './identity.js';
import { resolvePlayerText } from '../story/player-identity.js';
import { playerIdentity } from './player-identity.js';

function escapeHtml(value) {
  const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return brandedText(value).replace(/[&<>"']/g, (character) => entities[character]);
}

const renderers = {
  msn(contact) {
    const name = escapeHtml(contact.name);
    return {
      title: `${contact.name} — Conversation`,
      iconName: 'msn',
      body: /* HTML */ `
        <div class="msn-menu">
          Fichier <span>Édition</span><span>Actions</span><span>Aide</span>
        </div>
        <div class="msn-contact">
          <div class="avatar">${icon('msn')}</div>
          <div>
            <strong>${name}</strong
            ><small><i class="online-dot"></i> ${escapeHtml(contact.status)}</small>
          </div>
        </div>
        <div class="chat">
          ${contact.messages
            .map(
              (message) => `
          <small>${name} dit :</small>
          <p>${escapeHtml(message)}</p>
        `,
            )
            .join('')}
        </div>
        <div class="msn-tools">
          <span>☺</span><span>♡</span><span>♫</span><span class="wizz-word">WIZZ !</span>
        </div>
        <div class="fake-input">Écrivez votre message ici…<span>Envoyer</span></div>
        <div class="window-status">Dernier message reçu à 16:20</div>
      `,
    };
  },
  error(error) {
    return {
      title: brandedText(error.title),
      iconName: 'error',
      body: /* HTML */ `
        <div class="error-content">
          ${icon('error')}
          <div>
            <strong>${escapeHtml(error.heading)}</strong>
            <p>${escapeHtml(error.message)}</p>
          </div>
        </div>
        <div class="error-actions"><button class="xp-button" data-dismiss>OK</button></div>
      `,
    };
  },
  ad(ad) {
    return {
      title: `${applicationName('browser')} — Offre exclusive !`,
      iconName: 'globe',
      body: /* HTML */ `
        <div class="ad-address">${icon('globe')} http://${escapeHtml(ad.address)}</div>
        <div class="ad-content">
          <span class="ad-eyebrow">${escapeHtml(ad.eyebrow)}</span
          ><strong>${escapeHtml(ad.heading)}</strong>
          <div class="ad-prize">${escapeHtml(ad.lead)}<br /><b>${escapeHtml(ad.prize)}</b></div>
          <span class="ad-sticker">${escapeHtml(ad.sticker)}</span>
          <button class="ad-button" data-dismiss>${escapeHtml(ad.action)}</button>
        </div>
      `,
    };
  },
  virus(virus) {
    return {
      title: 'AntiVirus 2005 — Menace détectée !',
      iconName: 'shield',
      body: /* HTML */ `
        <div class="virus-banner">
          ${icon('shield')}
          <div>
            <small>${escapeHtml(virus.severity)}</small><strong>Un intrus sur le bureau !</strong>
          </div>
        </div>
        <div class="virus-content">
          <strong>${escapeHtml(virus.name)}</strong>
          <p>${escapeHtml(virus.description)}</p>
          <dl>
            <dt>Fichier suspect</dt>
            <dd>${escapeHtml(virus.file)}</dd>
            <dt>État</dt>
            <dd class="virus-status">En attente de votre intervention</dd>
          </dl>
        </div>
        <div class="virus-actions">
          <button class="xp-button" data-dismiss>Mettre en quarantaine</button>
        </div>
        <div class="window-status">Protection du bureau · AntiVirus 2005</div>
      `,
    };
  },
  download(download) {
    return {
      title: 'Téléchargement — Transfert en cours',
      iconName: 'download',
      body: /* HTML */ `
        <div class="download-header">
          ${icon('download')}
          <div>
            <strong>${escapeHtml(download.file)}</strong
            ><small>${escapeHtml(download.source)}</small>
          </div>
        </div>
        <div class="download-content">
          <div
            class="download-progress"
            role="progressbar"
            aria-label="Téléchargement"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow="${download.progress}"
          >
            <div style="width: ${download.progress}%"></div>
          </div>
          <div class="download-details">
            <span>${download.progress} % · ${escapeHtml(download.size)}</span
            ><span>${escapeHtml(download.eta)}</span>
          </div>
          <p>${escapeHtml(download.note)}</p>
        </div>
        <div class="download-actions">
          <button class="xp-button" data-dismiss>Annuler le transfert</button>
        </div>
        <div class="window-status">Connexion 56k · patience recommandée</div>
      `,
    };
  },
};

export function createPopupContent(type, random = Math.random, player = playerIdentity) {
  if (!Object.hasOwn(popupContent, type)) throw new Error(`Type de fenêtre inconnu : ${type}`);
  const variants = popupContent[type];
  const variant = variants[Math.floor(random() * variants.length)];
  const resolve = (value) => typeof value === 'string' ? resolvePlayerText(value, player) : value;
  const resolved = Object.fromEntries(Object.entries(variant).map(([key, value]) =>
    [key, Array.isArray(value) ? value.map(resolve) : resolve(value)]));
  const content = renderers[type](resolved);
  return { ...content, title: escapeHtml(content.title) };
}
