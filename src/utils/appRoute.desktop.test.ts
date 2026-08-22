import assert from 'node:assert/strict';
import {
  APP_ROUTE_PATHS,
  getCurrentAppPath,
  getTacticalShareId,
  getTimelineSkillDetailButtonId,
  getTimelineSkillDetailPath,
} from './appRoute';

assert.equal(getCurrentAppPath({ hash: '', pathname: '/' } as Location), APP_ROUTE_PATHS.root);
assert.equal(
  getCurrentAppPath({ hash: '#/data/buffs?source=menu', pathname: '/index.html' } as Location),
  APP_ROUTE_PATHS.buffSheet,
);
assert.equal(
  getCurrentAppPath({ hash: '#data/weapons/', pathname: '/ignored' } as Location),
  APP_ROUTE_PATHS.weaponSheet,
);
assert.equal(
  getCurrentAppPath({ hash: '', pathname: '/nested/index.html' } as Location),
  APP_ROUTE_PATHS.home,
);
assert.equal(
  getCurrentAppPath({ hash: '   ', pathname: '/ignored' } as Location),
  APP_ROUTE_PATHS.home,
);
assert.equal(
  getCurrentAppPath({ hash: '#/timeline/ai?launch=desktop', pathname: '/index.html' } as Location),
  '/timeline/ai',
);

const reservedButtonId = 'skill / 中文 ? #';
const detailPath = getTimelineSkillDetailPath(reservedButtonId);
assert.equal(detailPath, '/timeline/skill/skill%20%2F%20%E4%B8%AD%E6%96%87%20%3F%20%23');
assert.equal(getTimelineSkillDetailButtonId(detailPath), reservedButtonId);
assert.equal(getTimelineSkillDetailButtonId('/timeline/skill/'), null);
assert.equal(getTimelineSkillDetailButtonId(APP_ROUTE_PATHS.damageReportPpt), null);
assert.equal(getTimelineSkillDetailButtonId('/timeline/skill/%E0%A4%A'), null);
assert.equal(getTacticalShareId('/share/AbCdEfGhIjKlMn01'), 'AbCdEfGhIjKlMn01');
assert.equal(getTacticalShareId('/share/too-short'), null);
assert.equal(getTacticalShareId('/share/AbCdEfGhIjKlMn01/extra'), null);

console.log('App route and skill detail route contract: PASS');
