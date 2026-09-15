import test from 'node:test';
import assert from 'node:assert/strict';
import { placeExplanation } from '../lib/tooltip-placement.ts';

test('bottom card opens upwards, upper card downwards', () => {
  const viewport={top:0,left:0,width:1280,height:900};
  const bottom=placeExplanation({top:820,bottom:844,left:20,width:1100},viewport,440);
  assert.equal(bottom.side,'top');
  assert.ok(bottom.top+440<820);
  assert.equal(placeExplanation({top:60,bottom:84,left:20,width:1100},viewport,440).side,'bottom');
});
test('long content is capped to available space, including small and zoomed viewports', () => {
  for(const viewport of [{top:0,left:0,width:390,height:650},{top:150,left:30,width:260,height:300}]){
    for(const y of [15,100,viewport.height-40]){
      const position=placeExplanation({top:viewport.top+y,bottom:viewport.top+y+24,left:0,width:1300},viewport,2000);
      assert.ok(position.left>=viewport.left);
      assert.ok(position.left+position.width<=viewport.left+viewport.width);
      assert.ok(position.top>=viewport.top);
      assert.ok(position.top+position.maxHeight<=viewport.top+viewport.height);
    }
  }
});
