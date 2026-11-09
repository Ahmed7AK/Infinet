/**
 * The venue replica (src/engine/world/venue.ts) is built from the organisers' confidential plans, so its file
 * lives in git-ignored venue-private/. This glob finds it only in a local checkout that has it: the public repo
 * and the hosted site build without it, and the hall scene simply isn't there. Imported first in main.tsx, so the
 * hall is in the layout before anything reads it.
 */
import { registerVenue, type VenueFile } from '../engine/index';

const found = import.meta.glob<VenueFile>('../../venue-private/hall/venue.json', { eager: true, import: 'default' });
// ?public=1 shows what the public site shows (three scenes), for recording the public film on the booth laptop
const asPublic = new URLSearchParams(location.search).has('public');
if (!asPublic) for (const f of Object.values(found)) registerVenue(f);
