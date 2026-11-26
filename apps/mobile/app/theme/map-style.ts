export type MapStyleRule = {
  featureType?: string;
  elementType?: string;
  stylers: Array<Record<string, string | number>>;
};

export const darkMapStyle: MapStyleRule[] = [
  { elementType: 'geometry', stylers: [{ color: '#171717' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#B3B3B3' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#171717' }] },
  {
    featureType: 'landscape',
    elementType: 'geometry',
    stylers: [{ color: '#222222' }],
  },
  {
    featureType: 'road',
    elementType: 'geometry',
    stylers: [{ color: '#2c2c2c' }],
  },
  {
    featureType: 'road.arterial',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#F5F5F5' }],
  },
  {
    featureType: 'water',
    elementType: 'geometry',
    stylers: [{ color: '#0e1614' }],
  },
];
