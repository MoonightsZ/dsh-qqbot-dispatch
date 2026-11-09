export function createFeatureNavigation({ h, styles }) {
  return function FeatureNavigation({ features, selectedId, onSelect }) {
    return h('nav', { className: 'qqd-feature-nav', 'aria-label': '功能模组' },
      ...features.map((feature) => h('button', {
        key: feature.id,
        type: 'button',
        className: 'qqd-feature-nav-item',
        style: feature.id === selectedId ? styles.featureNavActive : styles.featureNavItem,
        'aria-current': feature.id === selectedId ? 'page' : undefined,
        onClick: () => onSelect(feature.id),
      },
      h('span', { style: styles.featureNavLabel }, feature.label),
      h('span', { style: feature.enabled ? styles.featureNavEnabled : styles.featureNavDisabled }, feature.enabled ? '已开启' : '已关闭'))),
    )
  }
}
