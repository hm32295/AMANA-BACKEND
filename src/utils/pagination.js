function parsePagination(query = {}, options = {}) {
  const defaultLimit = options.defaultLimit || 20;
  const maxLimit = options.maxLimit || 100;
  const allowedSortFields = options.allowedSortFields || ['createdAt'];
  const defaultSortBy = options.defaultSortBy || 'createdAt';

  const rawPage = Number.parseInt(String(query.page || '1'), 10);
  const rawLimit = Number.parseInt(String(query.limit || String(defaultLimit)), 10);

  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, maxLimit) : defaultLimit;
  const skip = (page - 1) * limit;

  const requestedSortBy = String(query.sortBy || defaultSortBy).trim();
  const sortBy = allowedSortFields.includes(requestedSortBy) ? requestedSortBy : defaultSortBy;
  const sortOrder = String(query.sortOrder || 'desc').toLowerCase() === 'asc' ? 1 : -1;

  return {
    page,
    limit,
    skip,
    sortBy,
    sortOrder,
    sortSpec: { [sortBy]: sortOrder, _id: sortOrder },
  };
}

function buildPaginationMeta(page, limit, total) {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return {
    page,
    limit,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
  };
}

module.exports = { parsePagination, buildPaginationMeta };
