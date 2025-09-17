QUnit.module('Helpers', function() {
  QUnit.test('heatIndexF', function(assert) {
    assert.strictEqual(heatIndexF(79, 80), 79, 'Should return temperature when temp is below 80F');
    assert.strictEqual(heatIndexF(85, 39), 85, 'Should return temperature when RH is below 40%');
    assert.strictEqual(heatIndexF(85, 85), 95, 'Calculates high heat index');
    assert.strictEqual(heatIndexF(90, 60), 100, 'Calculates high heat index');
    assert.strictEqual(heatIndexF(null, 80), null, 'Handles null temp');
    assert.strictEqual(heatIndexF(85, null), null, 'Handles null RH');
    assert.strictEqual(heatIndexF(80, 10), 78, 'Calculates with low RH adjustment');
    assert.strictEqual(heatIndexF(82, 90), 89, 'Calculates with high RH adjustment');
  });

  QUnit.test('dewPointF', function(assert) {
    assert.strictEqual(dewPointF(70, 50), 50, 'Calculates a standard dew point');
    assert.strictEqual(dewPointF(32, 100), 32, 'Calculates dew point at freezing');
    assert.strictEqual(dewPointF(90, 80), 83, 'Calculates a high dew point');
    assert.strictEqual(dewPointF(null, 50), null, 'Handles null temp');
    assert.strictEqual(dewPointF(70, null), null, 'Handles null RH');
    assert.strictEqual(dewPointF(70, 0), null, 'Handles 0% RH');
    assert.strictEqual(dewPointF(70, 101), null, 'Handles >100% RH');
    assert.strictEqual(dewPointF(70, 0.5), -47, 'Calculates dew point for very low RH');
  });

  QUnit.test('parseWindMph', function(assert) {
    assert.strictEqual(parseWindMph('10 mph'), 10, 'Parses simple wind speed');
    assert.strictEqual(parseWindMph('5 to 15 mph'), 15, 'Parses range and takes max');
    assert.strictEqual(parseWindMph('25 mph'), 25, 'Parses integer string');
    assert.strictEqual(parseWindMph(null), null, 'Handles null input');
    assert.strictEqual(parseWindMph(''), null, 'Handles empty string');
    assert.strictEqual(parseWindMph('calm'), null, 'Handles non-numeric string');
  });

  QUnit.test('gustMph', function(assert) {
    assert.strictEqual(gustMph({ windGust: 25 }), 25, 'Handles numeric gust');
    assert.strictEqual(gustMph({ windGust: '20 mph' }), 20, 'Parses string gust');
    assert.strictEqual(gustMph({ windGust: '15 to 30 mph' }), 30, 'Parses string range gust');
    assert.strictEqual(gustMph({ windGust: null }), null, 'Handles null gust');
    assert.strictEqual(gustMph({}), null, 'Handles missing gust property');
    assert.strictEqual(gustMph(null), null, 'Handles null period object');
  });

  QUnit.test('popVal', function(assert) {
    assert.strictEqual(popVal({ value: 50 }), 50, 'Extracts numeric value');
    assert.strictEqual(popVal({ value: 0 }), 0, 'Extracts zero value');
    assert.strictEqual(popVal({ value: null }), null, 'Handles null value');
    assert.strictEqual(popVal({}), null, 'Handles missing value property');
    assert.strictEqual(popVal(null), null, 'Handles null object');
  });

  QUnit.test('windNowText', function(assert) {
    assert.strictEqual(windNowText({ windDirection: 'N', windSpeed: '10 mph' }), 'N 10 mph', 'Formats simple wind text');
    assert.strictEqual(windNowText({ windDirection: 'SW', windSpeed: '5 to 10 mph' }), 'SW 5–10 mph', 'Formats ranged wind text');
    assert.strictEqual(windNowText({ windSpeed: '15 mph' }), '15 mph', 'Formats text with missing direction');
    assert.strictEqual(windNowText({ windDirection: 'E' }), 'E', 'Formats text with missing speed');
    assert.strictEqual(windNowText({}), '—', 'Handles empty period object');
    assert.strictEqual(windNowText(null), '—', 'Handles null period object');
  });
});
