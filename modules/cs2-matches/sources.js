/** Source capabilities shared by settings and notification filtering. hasValveTier selects the channel's tier system. */
export const CS2_SOURCES = [
  { id: 'liquipedia', label: 'Liquipedia', hasValveTier: true, requiresCredential: false },
  { id: 'pandascore', label: 'PandaScore', hasValveTier: false, requiresCredential: true },
]

export function cs2SourceFor(id) {
  return CS2_SOURCES.find((source) => source.id === id)
}
