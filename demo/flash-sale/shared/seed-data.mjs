// Sample catalogue shared by both demo variants.
export const PRODUCT = {
  id: 1,
  name: 'Limited Edition Holiday Sneakers',
  description: 'Only 100 pairs. One per customer. Sale starts at midnight.',
  priceCents: 4999,
  stock: 100,
};

export const REVIEWERS = [
  'Avery', 'Blake', 'Casey', 'Devon', 'Emerson', 'Finley',
  'Harper', 'Jordan', 'Kai', 'Logan', 'Morgan', 'Rowan',
];

export const REVIEWS = REVIEWERS.map((_, i) => ({
  userId: i + 1,
  rating: 3 + (i % 3),
  body: ['Super comfy.', 'Worth the wait.', 'Runs a little small.'][i % 3],
}));
