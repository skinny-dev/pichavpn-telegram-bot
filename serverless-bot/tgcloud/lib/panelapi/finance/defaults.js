// GENERATED from the MySQL defaults of the finance tables: the Serverless schema has no column defaults, so the panel API adds them to its INSERTs.
export default {
  "fin_accounts": {
    "is_postable": 1,
    "allow_negative": 0,
    "archived": 0,
    "sort_order": 0,
    "currency": "IRT",
    "created_at": 0
  },
  "fin_alloc": {
    "created_at": 0
  },
  "fin_assets": {
    "class": "equipment",
    "salvage": 0,
    "useful_life_months": 36,
    "status": "active",
    "created_at": 0
  },
  "fin_docs": {
    "kind": "attachment",
    "size": 0,
    "created_at": 0
  },
  "fin_journal": {
    "source_type": "manual",
    "status": "posted",
    "currency": "IRT",
    "rate": 1.0,
    "created_at": 0
  },
  "fin_journal_lines": {
    "debit": 0,
    "credit": 0
  },
  "fin_loans": {
    "interest_rate": 0.0,
    "installments": 1,
    "status": "active",
    "created_at": 0
  },
  "fin_ownership": {
    "percent": 0.0,
    "created_at": 0
  },
  "fin_parties": {
    "roles": "customer",
    "archived": 0,
    "created_at": 0
  },
  "fin_taxes": {
    "rate": 0.0,
    "kind": "sales",
    "archived": 0
  },
  "fin_txn": {
    "subtotal": 0,
    "discount": 0,
    "tax": 0,
    "total": 0,
    "paid": 0,
    "returned": 0,
    "refunded": 0,
    "status": "posted",
    "currency": "IRT",
    "rate": 1.0,
    "created_at": 0
  }
}
