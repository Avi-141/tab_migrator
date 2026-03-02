"""Similarity computation, deduplication, clustering (Louvain), and PageRank."""

import math
from collections import Counter, defaultdict
from typing import Dict, List, Optional, Tuple

from weft.utils.text import hamming_distance, jaccard, tokenize
from weft.utils.url import canonicalize_url


def cosine_similarity(a: Optional[List[float]], b: Optional[List[float]]) -> float:
    """Compute cosine similarity between two vectors."""
    if not a or not b:
        return 0.0
    if len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return dot / (norm_a * norm_b)


def similarity_score(ta: Dict, tb: Dict, domain_bonus: float) -> float:
    """Compute similarity score between two tabs, clamped to [0, 1]."""
    similarity = cosine_similarity(ta.get("embedding"), tb.get("embedding"))
    if similarity == 0.0:
        similarity = jaccard(ta.get("keywords", []), tb.get("keywords", []))
    if ta.get("domain") and ta.get("domain") == tb.get("domain"):
        similarity += domain_bonus
    return min(similarity, 1.0)


def build_similarity_matrix(tabs: List[Dict], domain_bonus: float) -> List[List[float]]:
    """Build pairwise similarity matrix for all tabs."""
    count = len(tabs)
    matrix = [[0.0 for _ in range(count)] for _ in range(count)]
    for i in range(count):
        for j in range(i + 1, count):
            score = similarity_score(tabs[i], tabs[j], domain_bonus)
            matrix[i][j] = score
            matrix[j][i] = score
    return matrix


def build_edges(
    tabs: List[Dict],
    similarity_matrix: List[List[float]],
    threshold: float,
) -> List[Dict]:
    """Build graph edges from similarity matrix."""
    edges: List[Dict] = []
    for i in range(len(tabs)):
        for j in range(i + 1, len(tabs)):
            weight = similarity_matrix[i][j]
            if weight >= threshold:
                reason = "similarity"
                if tabs[i].get("domain") == tabs[j].get("domain"):
                    reason = "similarity+domain"
                edges.append(
                    {
                        "source": tabs[i]["id"],
                        "target": tabs[j]["id"],
                        "weight": round(weight, 3),
                        "reason": reason,
                    }
                )
    return edges


# ============ LOUVAIN COMMUNITY DETECTION ============


def _build_adjacency(n: int, matrix: List[List[float]], threshold: float) -> Dict[int, Dict[int, float]]:
    """Build sparse adjacency from the similarity matrix, keeping only edges >= threshold."""
    adj: Dict[int, Dict[int, float]] = defaultdict(dict)
    for i in range(n):
        for j in range(i + 1, n):
            w = matrix[i][j]
            if w >= threshold:
                adj[i][j] = w
                adj[j][i] = w
    return adj


def _modularity(communities: Dict[int, int], adj: Dict[int, Dict[int, float]], m2: float) -> float:
    """Compute modularity Q for a given partition.

    Q = (1/2m) * sum_ij [ A_ij - (k_i * k_j) / 2m ] * delta(c_i, c_j)
    """
    if m2 == 0:
        return 0.0

    k: Dict[int, float] = defaultdict(float)
    for i in adj:
        for j, w in adj[i].items():
            k[i] += w

    q = 0.0
    for i in adj:
        for j, w in adj[i].items():
            if communities[i] == communities[j]:
                q += w - (k[i] * k[j]) / m2
    return q / m2


def louvain(
    n: int,
    matrix: List[List[float]],
    edge_threshold: float,
    resolution: float = 1.0,
) -> Tuple[Dict[int, int], float]:
    """Louvain community detection on a similarity matrix (phase 1 only).

    Returns a mapping of node index -> community id and the modularity score.

    The resolution parameter controls granularity: >1.0 finds smaller communities,
    <1.0 finds larger ones.

    TODO: Implement phase 2 (community contraction into super-nodes + repeat).
    Phase 1 alone is sufficient for tab-scale graphs (50-500 nodes), but phase 2
    would improve results on 1000+ node graphs by discovering hierarchical structure.
    """
    adj = _build_adjacency(n, matrix, edge_threshold)

    k: Dict[int, float] = defaultdict(float)
    for i in range(n):
        for j, w in adj.get(i, {}).items():
            k[i] += w

    m2 = sum(k.values())
    if m2 == 0:
        return {i: i for i in range(n)}, 0.0

    community = {i: i for i in range(n)}

    # Sum of weights inside each community
    sigma_in: Dict[int, float] = defaultdict(float)
    # Sum of weights incident to each community (including external)
    sigma_tot: Dict[int, float] = defaultdict(float)
    for i in range(n):
        sigma_tot[i] = k[i]

    improved = True
    while improved:
        improved = False
        for i in range(n):
            ci = community[i]

            # Compute weights to neighboring communities
            neighbor_weights: Dict[int, float] = defaultdict(float)
            for j, w in adj.get(i, {}).items():
                neighbor_weights[community[j]] += w

            # Remove i from its community
            sigma_in[ci] -= 2.0 * neighbor_weights.get(ci, 0.0)
            sigma_tot[ci] -= k[i]

            best_community = ci
            best_gain = 0.0

            for c, w_ic in neighbor_weights.items():
                # Modularity gain of moving i to community c
                gain = (2.0 * w_ic - resolution * sigma_tot.get(c, 0.0) * k[i] / m2)
                if gain > best_gain:
                    best_gain = gain
                    best_community = c

            # Move i to best community
            community[i] = best_community
            sigma_in[best_community] += 2.0 * neighbor_weights.get(best_community, 0.0)
            sigma_tot[best_community] += k[i]

            if best_community != ci:
                improved = True

    # Renumber communities to 0..N-1
    unique = sorted(set(community.values()))
    remap = {old: new for new, old in enumerate(unique)}
    community = {i: remap[c] for i, c in community.items()}

    q = _modularity(community, adj, m2)
    return community, q


def build_groups_louvain(
    tabs: List[Dict],
    similarity_matrix: List[List[float]],
    edge_threshold: float = 0.15,
    resolution: float = 1.0,
) -> Tuple[List[Dict], Dict[int, int], float]:
    """Cluster tabs using Louvain community detection.

    Returns (groups, tab_to_group, modularity).
    """
    n = len(tabs)
    if n == 0:
        return [], {}, 0.0

    community, modularity = louvain(n, similarity_matrix, edge_threshold, resolution)

    groups_map: Dict[int, List[int]] = defaultdict(list)
    for idx, cid in community.items():
        groups_map[cid].append(idx)

    groups: List[Dict] = []
    tab_to_group: Dict[int, int] = {}
    for gid, indices in sorted(groups_map.items()):
        tab_ids = [tabs[i]["id"] for i in indices]
        groups.append({"id": gid, "tab_ids": tab_ids, "size": len(tab_ids)})
        for tid in tab_ids:
            tab_to_group[tid] = gid

    return groups, tab_to_group, modularity


# ============ PAGERANK ============


def pagerank(
    n: int,
    matrix: List[List[float]],
    edge_threshold: float = 0.1,
    damping: float = 0.85,
    max_iter: int = 100,
    tol: float = 1e-6,
) -> List[float]:
    """Compute PageRank scores for nodes in a weighted graph.

    Uses the similarity matrix as a weighted adjacency. Edges below threshold are ignored.
    Returns a list of scores (one per node), summing to 1.0.
    """
    if n == 0:
        return []

    # Build weighted out-degree and adjacency
    out_weight = [0.0] * n
    adj: List[List[Tuple[int, float]]] = [[] for _ in range(n)]

    for i in range(n):
        for j in range(n):
            if i != j and matrix[i][j] >= edge_threshold:
                w = matrix[i][j]
                adj[j].append((i, w))
                out_weight[i] += w

    rank = [1.0 / n] * n
    base = (1.0 - damping) / n

    for _ in range(max_iter):
        new_rank = [base] * n
        dangling_sum = sum(rank[i] for i in range(n) if out_weight[i] == 0)
        dangling_contrib = damping * dangling_sum / n

        for j in range(n):
            s = 0.0
            for i, w in adj[j]:
                if out_weight[i] > 0:
                    s += rank[i] * w / out_weight[i]
            new_rank[j] += damping * s + dangling_contrib

        diff = sum(abs(new_rank[i] - rank[i]) for i in range(n))
        rank = new_rank
        if diff < tol:
            break

    return rank


# ============ LEGACY BUILD_GROUPS (kept for backward compat) ============


def build_groups(
    tabs: List[Dict],
    similarity_matrix: List[List[float]],
    threshold: float,
    domain_group: bool,
    domain_group_min: int,
    mutual_knn: bool,
    knn_k: int,
) -> Tuple[List[Dict], Dict[int, int]]:
    """Cluster tabs into groups using Union-Find with domain grouping and mutual KNN.

    Legacy method — prefer build_groups_louvain for better cluster quality.
    """
    parent = list(range(len(tabs)))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    if domain_group:
        domain_map: Dict[str, List[int]] = {}
        for idx, tab in enumerate(tabs):
            domain = tab.get("domain")
            if domain:
                domain_map.setdefault(domain, []).append(idx)
        for indices in domain_map.values():
            if len(indices) >= max(2, domain_group_min):
                root = indices[0]
                for idx in indices[1:]:
                    union(root, idx)

    if mutual_knn:
        neighbors = []
        for i in range(len(tabs)):
            scored = [(j, similarity_matrix[i][j]) for j in range(len(tabs)) if j != i]
            scored.sort(key=lambda t: t[1], reverse=True)
            filtered = [j for j, score in scored if score >= threshold]
            if knn_k > 0:
                filtered = filtered[:knn_k]
            neighbors.append(set(filtered))
        for i in range(len(tabs)):
            for j in neighbors[i]:
                if i in neighbors[j]:
                    union(i, j)
    else:
        for i in range(len(tabs)):
            for j in range(i + 1, len(tabs)):
                if similarity_matrix[i][j] >= threshold:
                    union(i, j)

    groups_map: Dict[int, List[int]] = {}
    for idx in range(len(tabs)):
        root = find(idx)
        groups_map.setdefault(root, []).append(idx)

    groups: List[Dict] = []
    tab_to_group: Dict[int, int] = {}
    for gid, (root, indices) in enumerate(groups_map.items()):
        group_tabs = [tabs[i] for i in indices]
        tab_ids = [t["id"] for t in group_tabs]
        groups.append({"id": gid, "tab_ids": tab_ids, "size": len(tab_ids)})
        for tid in tab_ids:
            tab_to_group[tid] = gid
    return groups, tab_to_group


def dedupe_tabs(tabs: List[Dict], hamming_threshold: int) -> Tuple[Dict[int, int], int]:
    """Deduplicate tabs using canonical URLs and SimHash."""
    parent = list(range(len(tabs)))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    # Canonical URL matching
    canonical_map: Dict[str, int] = {}
    for idx, tab in enumerate(tabs):
        canonical = tab.get("canonical_url") or canonicalize_url(tab.get("url", ""))
        if not canonical:
            continue
        tab["canonical_url"] = canonical
        if canonical in canonical_map:
            union(idx, canonical_map[canonical])
        else:
            canonical_map[canonical] = idx

    # SimHash near-duplicate detection (same domain only)
    for i in range(len(tabs)):
        sim_a = tabs[i].get("simhash")
        if sim_a is None:
            continue
        for j in range(i + 1, len(tabs)):
            sim_b = tabs[j].get("simhash")
            if sim_b is None:
                continue
            if tabs[i].get("domain") and tabs[i].get("domain") == tabs[j].get("domain"):
                if hamming_distance(sim_a, sim_b) <= hamming_threshold:
                    union(i, j)

    # Build primary map and count duplicates
    groups: Dict[int, List[int]] = {}
    for idx in range(len(tabs)):
        root = find(idx)
        groups.setdefault(root, []).append(idx)

    duplicates = 0
    primary_map: Dict[int, int] = {}
    for indices in groups.values():
        primary = min(indices)
        aliases = []
        for idx in indices:
            if idx != primary:
                duplicates += 1
                primary_map[idx] = primary
                aliases.append(tabs[idx].get("url"))
            else:
                primary_map[idx] = primary
        if aliases:
            primary_tab = tabs[primary]
            existing = set(primary_tab.get("aliases", []))
            for url in aliases:
                if url:
                    existing.add(url)
            primary_tab["aliases"] = sorted(existing)
            for idx in indices:
                if idx != primary:
                    tabs[idx]["duplicate_of"] = primary
                    if not tabs[idx].get("canonical_url"):
                        tabs[idx]["canonical_url"] = primary_tab.get("canonical_url")
    return primary_map, duplicates


def compute_idf(docs_tokens: List[List[str]]) -> Dict[str, float]:
    """Compute inverse document frequency for tokens."""
    doc_count = len(docs_tokens)
    df = Counter()
    for tokens in docs_tokens:
        for token in set(tokens):
            df[token] += 1
    idf = {}
    for token, count in df.items():
        idf[token] = math.log((1 + doc_count) / (1 + count)) + 1.0
    return idf


def top_tfidf_terms(tokens: List[str], idf: Dict[str, float], max_terms: int) -> List[str]:
    """Get top terms by TF-IDF score."""
    tf = Counter(tokens)
    scored = []
    for token, count in tf.items():
        scored.append((token, count * idf.get(token, 0.0)))
    scored.sort(key=lambda t: t[1], reverse=True)
    return [token for token, _ in scored[:max_terms]]


def label_group(group_tabs: List[Dict], idf: Dict[str, float]) -> str:
    """Generate a label for a group of tabs."""
    domains = [t.get("domain") for t in group_tabs if t.get("domain")]
    if domains:
        counts = Counter(domains)
        domain, count = counts.most_common(1)[0]
        if count / max(1, len(group_tabs)) >= 0.55:
            return domain
    tokens: List[str] = []
    for tab in group_tabs:
        tokens.extend(tab.get("tokens", []))
    top_terms = top_tfidf_terms(tokens, idf, 3)
    if top_terms:
        return " / ".join(top_terms)
    return "group"
