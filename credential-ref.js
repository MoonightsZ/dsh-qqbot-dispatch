/** Keep legacy Liquipedia references stable while isolating PandaScore credentials. */
export function credentialRefFor(featureId, sourceId = 'liquipedia') {
  const feature = String(featureId).toUpperCase().replace(/[^A-Z0-9]/g, '_')
  return sourceId === 'pandascore' ? `QQBOT_DISPATCH_${feature}_PANDASCORE_API_KEY` : `QQBOT_DISPATCH_${feature}_API_KEY`
}
