/** The four places added on 11 Nov: one scene per area, drawn from the geometry in src/engine/world/areas.ts. */
import type { AreaId } from '../../../engine/index';
import { Downtown } from './Downtown';
import { Metro } from './Metro';
import { Park } from './Park';
import { Souk } from './Souk';

export function AreaScene({ id }: { id: AreaId }) {
  return id === 'park' ? <Park /> : id === 'downtown' ? <Downtown /> : id === 'metro' ? <Metro /> : <Souk />;
}
