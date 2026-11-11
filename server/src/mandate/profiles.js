import { db as defaultDb, getMandate as defaultGetMandate, listMandates as defaultListMandates, saveMandate as defaultSaveMandate } from '../db.js';
import { append as defaultAppend } from '../audit.js';
import { buildProfile, deriveTaskMandate as deriveTask, profileLimitsSchema } from '../mandates/v3.js';
import { parseProfileInstruction } from '../llm/mandateParser.js';

export class ProfileError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'ProfileError';
    this.code = code;
    this.status = status;
  }
}

export function createProfileService({ database = defaultDb, append = defaultAppend, getMandate = defaultGetMandate,
  listMandates = defaultListMandates, saveMandate = defaultSaveMandate } = {}) {
  function ownerProfiles(ownerId) {
    return listMandates().filter((mandate) => mandate.kind === 'profile' && mandate.owner_id === ownerId);
  }

  async function createProfile(input, { now = new Date(), owner_id = 'local-user' } = {}) {
    let limits;
    let instruction = '';
    if (typeof input === 'string') {
      instruction = input;
      limits = await parseProfileInstruction(input);
    } else if (input && typeof input === 'object' && typeof input.instruction === 'string' && input.limits === undefined) {
      instruction = input.instruction;
      limits = await parseProfileInstruction(instruction);
    } else {
      limits = input?.limits ?? input;
    }
    const parsed = profileLimitsSchema.safeParse(limits);
    if (!parsed.success) throw new ProfileError('INVALID_PROFILE', 'Profile limits are invalid.', 422);
    let profile;
    try { profile = buildProfile(parsed.data, { now, owner_id, instruction }); }
    catch (cause) { throw new ProfileError('INVALID_PROFILE', cause.message, 422); }
    saveMandate(profile);
    append({ actor: 'user', event_type: 'PROFILE_PROPOSED', mandate_id: profile.mandate_id, payload: { owner_id, status: profile.status } });
    return profile;
  }

  function confirmProfile(profileId, { owner_id = 'local-user', now = new Date() } = {}) {
    const profile = getMandate(profileId);
    if (!profile || profile.kind !== 'profile' || profile.owner_id !== owner_id) throw new ProfileError('PROFILE_NOT_FOUND', 'Profile not found.', 404);
    if (profile.status !== 'pending_confirmation') throw new ProfileError('INVALID_PROFILE_STATE', 'Only a pending profile can be confirmed.', 409);
    const confirmed_at = new Date(now).toISOString();
    const confirmed = { ...profile, status: 'active', confirmed_at, confirmed_by: 'user' };
    saveMandate(confirmed);
    append({ actor: 'user', event_type: 'PROFILE_CONFIRMED', mandate_id: profileId, payload: { owner_id, confirmed_at } });
    return confirmed;
  }

  function listProfiles({ owner_id = 'local-user' } = {}) {
    return ownerProfiles(owner_id);
  }

  function setDefault(profileId, { owner_id = 'local-user', now = new Date() } = {}) {
    const profile = getMandate(profileId);
    if (!profile || profile.kind !== 'profile' || profile.owner_id !== owner_id) throw new ProfileError('PROFILE_NOT_FOUND', 'Profile not found.', 404);
    const expiry = Date.parse(profile.expires_at);
    if (profile.status !== 'active' || !Number.isFinite(expiry) || expiry <= new Date(now).getTime()) throw new ProfileError('PROFILE_INACTIVE', 'Only a confirmed, unexpired profile can be the default.', 409);
    const profiles = ownerProfiles(owner_id);
    const transaction = database.transaction(() => {
      for (const entry of profiles) {
        const is_default = entry.mandate_id === profileId;
        if (entry.is_default !== is_default) saveMandate({ ...entry, is_default });
      }
    });
    transaction();
    const selected = getMandate(profileId);
    append({ actor: 'user', event_type: 'DEFAULT_PROFILE_CHANGED', mandate_id: profileId, payload: { owner_id } });
    return selected;
  }

  function createDerivedTaskMandate(profile, parsed, { now = new Date(), owner_id = profile.owner_id ?? 'local-user', instruction = '', force_confirmation = false } = {}) {
    const derived = deriveTask(profile, parsed, { now, owner_id });
    const forcePending = force_confirmation && derived.within_profile;
    const mandate = { ...derived.mandate, original_instruction: instruction,
      ...(forcePending ? { status: 'pending_confirmation', confirmed_at: null, confirmed_by: null } : {}) };
    const notes = derived.exceeded.map((limit) => `Requested ${limit} exceeds the confirmed profile; user confirmation is required.`);
    saveMandate(mandate);
    if (derived.within_profile && !forcePending) {
      append({ actor: 'user', event_type: 'MANDATE_AUTO_ACTIVATED', mandate_id: mandate.mandate_id,
        payload: { parent_profile_id: profile.mandate_id, limits: {
          max_total_cents: mandate.max_total_cents, allow_bundles: mandate.allow_bundles,
          allow_addons: mandate.allow_addons, require_first_party: mandate.require_first_party,
          allowed_domains: mandate.allowed_domains,
        } } });
    } else {
      append({ actor: 'user', event_type: 'MANDATE_PROPOSED', mandate_id: mandate.mandate_id,
        payload: { parent_profile_id: profile.mandate_id, exceeded: derived.exceeded, numeric_crosscheck: forcePending } });
    }
    return { ...derived, within_profile: derived.within_profile && !forcePending, mandate, notes };
  }

  return Object.freeze({ createProfile, confirmProfile, listProfiles, setDefault, createDerivedTaskMandate });
}

const profiles = createProfileService();
export const createProfile = profiles.createProfile;
export const confirmProfile = profiles.confirmProfile;
export const listProfiles = profiles.listProfiles;
export const setDefault = profiles.setDefault;
export function deriveTaskMandate(profile, parsed, options) {
  return deriveTask(profile, parsed, options);
}
export const createDerivedTaskMandate = profiles.createDerivedTaskMandate;
