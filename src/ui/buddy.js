import config from '../config/buddy.json' with { type: 'json' };
import { icon } from './icons.js';
import { normalizePlayerIdentityPatch, validatePlayerNickname } from '../story/player-identity.js';

export function buddyIdentitySelection(identityGender, grammaticalGender) {
  return normalizePlayerIdentityPatch({ identityGender, grammaticalGender, completed: true });
}

// Passive assistant: only explicit activation can unlock future story bubbles.
export class Buddy {
  constructor(root, progression, definition = config) {
    Object.assign(this, { progression, definition });
    this.element = document.createElement('aside');
    this.element.className = 'buddy';
    this.element.setAttribute('aria-label', 'Assistant Buddy');
    this.element.innerHTML = `<div class="buddy-bubble" hidden><button class="buddy-close" aria-label="Fermer la bulle de Buddy">×</button><p role="status" aria-live="polite"></p></div>
      <div class="buddy-figure">${icon('buddy', 'buddy-character')}<button class="buddy-hide" aria-label="Masquer Buddy">×</button></div>`;
    root.append(this.element);
    this.bubble = this.element.querySelector('.buddy-bubble');
    this.text = this.element.querySelector('p');
    this.question = document.createElement('form'); this.question.className='buddy-question'; this.question.hidden=true;
    this.question.innerHTML='<input autocomplete="off" aria-label="Pseudonyme"><button type="submit">Valider</button><div class="buddy-options"></div><span role="alert"></span>';
    this.bubble.append?.(this.question);
    this.setupModal = document.createElement('div');
    this.setupModal.className = 'buddy-setup-backdrop'; this.setupModal.hidden = true;
    this.setupModal.innerHTML = '<section class="buddy-setup" role="dialog" aria-modal="true"><header>Assistant de configuration Windows XD</header><div class="buddy-setup-mascot"></div><p class="buddy-setup-text" role="status" aria-live="polite"></p></section>';
    root.append(this.setupModal);
    this.modalText = this.setupModal.querySelector('.buddy-setup-text');
    this.setupModal.querySelector('.buddy-setup-mascot').innerHTML = icon('buddy', 'buddy-character');
    this.setupModal.querySelector('.buddy-setup').append?.(this.question);
    this.question.addEventListener('submit', e=>{e.preventDefault();this.answerSetup();});
    this.question.addEventListener('click',e=>{const b=e.target.closest('[data-value]');if(b)this.chooseSetup(b.dataset.value);});
    this.element.querySelector('.buddy-close').addEventListener('click', () => this.closeBubble());
    this.element.querySelector('.buddy-hide').addEventListener('click', () => this.hide());
    this.restore();
  }
  restore() {
    const saved = this.progression.data.buddy;
    this.opened = saved?.opened === true;
    this.visible = this.opened && saved?.visible === true;
    this.sequence = [];
    this.hideAt = this.nextAt = null;
    this.tipIndex = 0;
    this.onboarding = this.progression.data.buddyOnboarding?.done ? null : this.progression.data.buddyOnboarding ?? null;
    this.bubble.hidden = true;
    this.animate('idle');
    this.render();
  }
  persist() {
    this.progression.data.buddy = { opened: this.opened, visible: this.visible };
    this.progression.save();
  }
  setActive(active) {
    this.active = active;
    this.render();
  }
  render() {
    this.element.hidden = !this.active || (!this.visible && this.hideAt === null);
  }
  animate(name) {
    this.element.dataset.animation = name;
  }
  open(now = Date.now()) {
    const first = !this.opened;
    this.opened = this.visible = true;
    this.hideAt = null;
    this.persist();
    this.render();
    if (first) {
      this.sequence = [...this.definition.introduction];
      this.next(now);
    } else if (!this.sequence.length && this.nextAt === null) {
      this.say(this.definition.tips[this.tipIndex++ % this.definition.tips.length], { now });
    }
  }
  startPlayerSetup(onComplete = () => {}) {
    const savedSetup = this.progression.data.buddyOnboarding;
    if (this.progression.data.playerIdentity?.completed && (!savedSetup || savedSetup.done)) { onComplete(); return false; }
    this.setupComplete = onComplete;
    this.onboarding = this.progression.data.buddyOnboarding ?? { step: 'welcome' };
    this.opened = this.visible = true; this.active = true; this.hideAt = null; this.persist(); this.render(); this.showSetupStep();
    return true;
  }
  showSetupStep() {
    const step = this.onboarding?.step;
    if (!step) return;
    const options = this.question.querySelector('.buddy-options'); options.replaceChildren();
    const input = this.question.querySelector('input');
    const submit = this.question.querySelector('button[type="submit"]');
    const alert = this.question.querySelector('[role="alert"]'); alert.textContent = '';
    const buttons = (choices) => choices.forEach(([label, value]) => { const b=document.createElement('button'); b.type='button'; b.dataset.value=value; b.textContent=label; options.append(b); });
    this.setupModal.hidden = false; this.question.hidden = false; this.nextAt = null;
    if (step === 'welcome') { this.modalText.textContent='Félicitations ! Vous avez terminé votre première partie de Chaos Survival ! Avant de poursuivre, permettez-moi de configurer votre profil utilisateur.'; input.hidden=true; submit.hidden=false; submit.textContent='Continuer'; }
    if (step === 'nickname') { this.modalText.textContent='Tout d’abord, quel pseudonyme souhaitez-vous utiliser ?'; input.hidden=false; input.value=this.onboarding.nickname??''; submit.hidden=false; submit.textContent='Continuer'; }
    if (step === 'gender') { this.modalText.textContent='Très bien ! Et comment vous identifiez-vous ?'; input.hidden=true; submit.hidden=true; buttons([['Un garçon','boy'],['Une fille','girl'],['Aucun des deux','neither']]); }
    if (step === 'grammar') { this.modalText.textContent='Quels accords grammaticaux préférez-vous ?'; input.hidden=true; submit.hidden=true; buttons([['Masculins','male'],['Féminins','female']]); }
    if (step === 'done') { this.modalText.textContent='Parfait ! Votre profil utilisateur est maintenant configuré. Amusez-vous bien sur Windows XD !'; input.hidden=true; submit.hidden=false; submit.textContent='Terminer'; }
    if (input.hidden) submit.focus?.(); else input.focus?.();
  }
  saveSetup(step, values={}) { this.onboarding={...this.onboarding,...values,step}; this.progression.data.buddyOnboarding=this.onboarding; this.progression.save(); this.showSetupStep(); }
  answerSetup() {
    if (this.onboarding?.step === 'welcome') return this.saveSetup('nickname');
    if (this.onboarding?.step === 'done') { this.onboarding=null; this.progression.data.buddyOnboarding={done:true}; this.progression.save(); this.question.hidden=true; this.setupModal.hidden=true; this.setupComplete?.(); return; }
    const input=this.question.querySelector('input');
    const nickname=input.value;
    if (!validatePlayerNickname(nickname)) { this.question.querySelector('[role="alert"]').textContent='Saisissez un pseudonyme de 3 à 16 caractères visibles, sans caractère de contrôle.'; return; }
    this.progression.updatePlayerIdentity({nickname}); this.progression.save(); this.saveSetup('gender',{nickname:this.progression.data.playerIdentity.nickname});
  }
  chooseSetup(value) {
    if (this.onboarding?.step==='gender') {
      if (!['boy','girl','neither'].includes(value)) return;
      this.saveSetup('grammar',{identityGender:value});
    } else if (this.onboarding?.step==='grammar') {
      const patch=buddyIdentitySelection(this.onboarding.identityGender,value);
      if (!patch || !this.progression.updatePlayerIdentity(patch)) return;
      this.saveSetup('done',{grammaticalGender:value});
    }
  }
  next(now) {
    const message = this.sequence.shift();
    if (message) this.say(message.text, { ...message, now });
    else this.closeBubble();
  }
  // Reusable hook for future events; never auto-activates an unopened/hidden assistant.
  say(text, { durationMs = 5000, animation = 'explaining', now = Date.now() } = {}) {
    if (!this.opened || !this.visible || typeof text !== 'string') return false;
    this.text.textContent = text;
    this.bubble.hidden = false;
    this.animate(animation);
    this.nextAt = now + durationMs;
    return true;
  }
  closeBubble() {
    if (this.onboarding) return;
    this.sequence = [];
    this.nextAt = null;
    this.bubble.hidden = true;
    this.animate('idle');
  }
  hide(now = Date.now()) {
    if (this.onboarding) return;
    if (!this.visible) return;
    this.closeBubble();
    this.visible = false;
    this.hideAt = now + 300;
    this.animate('leaving');
    this.persist();
    this.render();
  }
  update(now = Date.now()) {
    if (this.hideAt !== null && now >= this.hideAt) {
      this.hideAt = null;
      this.render();
    }
    if (this.nextAt !== null && now >= this.nextAt) this.next(now);
  }
}
