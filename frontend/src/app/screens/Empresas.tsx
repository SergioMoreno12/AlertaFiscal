import { useState } from "react";
import { Building2, Plus, Edit3, Search } from "lucide-react";
import { NewCompanyCard } from "../Workspace";
import { EditCompanyModal } from "../Records";
import { Badge, Btn, Card, SectionHeader, roleLabel } from "../ui";
import { type Company } from "../../api/fiscal.api";
import { ESTADO_CONFIG } from "../shared";

// ─── SCREENS ──────────────────────────────────────────────────────────────────

// EMPRESAS
export const EmpresasScreen = ({
  companies,
  onSelect,
  onCreated,
  onUpdated,
  canEdit,
}: {
  companies: Array<{ id: number; nombre: string; nit: string; sector: string; tamaño: string; role?: string; estado?: string }>;
  onSelect: (id: number) => void;
  onCreated: (company: Company) => void;
  onUpdated: (company: Company) => void;
  canEdit: boolean;
}) => {
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const editingCompany = companies.find((company) => company.id === editingId) ?? null;
  const [creatingRequested, setCreating] = useState(false);
  // Without companies the form is the only useful thing on the screen, so it stays open.
  const creating = creatingRequested || companies.length === 0;
  const filtered = companies.filter((e) => e.nombre.toLowerCase().includes(search.toLowerCase()));

  return (
    <div style={{ padding: "28px 32px" }}>
      <SectionHeader
        title="Companies"
        subtitle="Select a company to see its tax planning"
        actions={!creating ? <Btn icon={<Plus size={14} />} onClick={() => setCreating(true)}>New company</Btn> : undefined}
      />

      {creating && (
        <NewCompanyCard
          onCreated={(company) => {
            setCreating(false);
            onCreated(company);
          }}
          onCancel={companies.length > 0 ? () => setCreating(false) : undefined}
        />
      )}

      {companies.length > 0 && <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
        <div style={{ flex: 1, position: "relative" }}>
          <Search size={15} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#66786F" }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search company..." style={{ width: "100%", padding: "10px 14px 10px 36px", borderRadius: 9, border: "1.5px solid #D3DDD8", fontSize: 13, fontFamily: "inherit", color: "#33433B", backgroundColor: "#fff", boxSizing: "border-box", outline: "none" }} />
        </div>
      </div>}

      {filtered.length === 0 && (
        <Card style={{ padding: "32px 24px", textAlign: "center", color: "#66786F", fontSize: 13 }}>
          {companies.length === 0
            ? "You have no companies yet. Create one above, or ask an administrator to add you to theirs."
            : "No company matches the search."}
        </Card>
      )}

      <div style={{ display: "grid", gap: 16 }}>
        {filtered.map((emp) => {
          const st = emp.estado
            ? ESTADO_CONFIG[emp.estado] ?? ESTADO_CONFIG["por-revisar"]
            : { label: emp.role ? roleLabel(emp.role) : "Active", color: "#1B5E3F", bg: "#E3F1E8", border: "#9CCDB1" };
          return (
            <Card key={emp.id} style={{ padding: "20px 24px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
                <div style={{ width: 44, height: 44, backgroundColor: "#E3F1E8", borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Building2 size={22} color="#1B5E3F" />
                </div>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontWeight: 700, fontSize: 15, color: "#33433B" }}>{emp.nombre}</div>
                  <div style={{ fontSize: 12, color: "#66786F", marginTop: 3 }}>
                    NIT: {emp.nit} · {emp.sector} · {emp.tamaño}{emp.role ? ` · ${roleLabel(emp.role)}` : ""}
                  </div>
                </div>
                <Badge label={st.label} color={st.color} bg={st.bg} border={st.border} />
                {canEdit && emp.role === "admin" && <Btn variant="ghost" small icon={<Edit3 size={13} />} onClick={() => setEditingId(emp.id)}>Edit</Btn>}
                <Btn variant="primary" small onClick={() => onSelect(emp.id)}>Select</Btn>
              </div>
            </Card>
          );
        })}
      </div>

      {editingCompany && (
        <EditCompanyModal
          company={{ id: editingCompany.id, name: editingCompany.nombre, nit: editingCompany.nit, sector: editingCompany.sector, size: editingCompany.tamaño }}
          onClose={() => setEditingId(null)}
          onSaved={(company) => {
            onUpdated(company);
            setEditingId(null);
          }}
        />
      )}
    </div>
  );
};
