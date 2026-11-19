import Foundation

/// Bảng thuật ngữ Anh → Việt chuyên ngành Răng Hàm Mặt.
/// Định dạng văn bản: mỗi dòng `English term<TAB>thuật ngữ tiếng Việt` (hoặc ngăn cách bằng ` = `).
/// Dòng bắt đầu bằng `#` là chú thích.
public struct Glossary: Sendable, Equatable {
    public struct Entry: Sendable, Equatable {
        public var english: String
        public var vietnamese: String
    }

    public var entries: [Entry]

    public init(entries: [Entry]) { self.entries = entries }

    public static func parse(_ text: String) -> Glossary {
        var entries: [Entry] = []
        for raw in text.components(separatedBy: .newlines) {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.isEmpty || line.hasPrefix("#") { continue }
            let parts: [String]
            if line.contains("\t") {
                parts = line.components(separatedBy: "\t")
            } else if line.contains(" = ") {
                parts = line.components(separatedBy: " = ")
            } else {
                continue
            }
            let en = parts[0].trimmingCharacters(in: .whitespaces)
            let vi = parts.dropFirst().joined(separator: " ").trimmingCharacters(in: .whitespaces)
            if !en.isEmpty && !vi.isEmpty { entries.append(Entry(english: en, vietnamese: vi)) }
        }
        return Glossary(entries: entries)
    }

    /// Dạng đưa vào prompt (ổn định từng byte để prompt caching hoạt động).
    public var promptText: String {
        entries.map { "\($0.english) => \($0.vietnamese)" }.joined(separator: "\n")
    }

    public static let defaultText: String = """
    # Bảng thuật ngữ mặc định — sửa trong Cài đặt. Định dạng: English<TAB>Tiếng Việt
    # Giải phẫu
    tooth / teeth\trăng
    maxilla\txương hàm trên
    mandible\txương hàm dưới
    temporomandibular joint (TMJ)\tkhớp thái dương hàm
    condyle (mandibular)\tlồi cầu xương hàm dưới
    coronoid process\tmỏm vẹt
    ramus (mandibular)\tcành cao xương hàm dưới (cành lên)
    mandibular angle\tgóc hàm
    symphysis\tvùng cằm (khớp dính cằm)
    zygomatic bone\txương gò má
    zygomatic arch\tcung gò má
    orbit\tổ mắt
    maxillary sinus\txoang hàm trên
    hard palate\tkhẩu cái cứng (vòm miệng cứng)
    soft palate\tkhẩu cái mềm (vòm miệng mềm)
    alveolar process\tmỏm xương ổ răng
    alveolar bone\txương ổ răng
    enamel\tmen răng
    dentin\tngà răng
    pulp\ttủy răng
    pulp chamber\tbuồng tủy
    root canal\tống tủy
    cementum\txê măng chân răng
    periodontal ligament (PDL)\tdây chằng nha chu
    periodontium\tmô nha chu
    gingiva\tlợi (nướu)
    attached gingiva\tlợi dính
    free gingiva\tlợi tự do
    mucogingival junction\tđường tiếp nối niêm mạc – lợi
    crown (anatomical)\tthân răng
    root\tchân răng
    apex\tchóp chân răng (cuống răng)
    furcation\tvùng chẽ chân răng
    cemento-enamel junction (CEJ)\tđường nối men – xê măng
    incisor\trăng cửa
    canine\trăng nanh
    premolar\trăng hàm nhỏ
    molar\trăng hàm lớn
    third molar / wisdom tooth\trăng khôn (răng hàm lớn thứ ba)
    primary (deciduous) teeth\trăng sữa
    permanent teeth\trăng vĩnh viễn
    mixed dentition\tbộ răng hỗn hợp
    mesial\tphía gần
    distal\tphía xa
    buccal\tphía má (mặt ngoài)
    labial\tphía môi (mặt ngoài)
    lingual\tphía lưỡi (mặt trong)
    palatal\tphía khẩu cái (mặt trong)
    occlusal\tmặt nhai
    incisal edge\trìa cắn
    inferior alveolar nerve\tthần kinh huyệt răng dưới (thần kinh răng dưới)
    lingual nerve\tthần kinh lưỡi
    mental foramen\tlỗ cằm
    trigeminal nerve\tthần kinh sinh ba (dây V)
    facial nerve\tthần kinh mặt (dây VII)
    parotid gland\ttuyến mang tai
    submandibular gland\ttuyến dưới hàm
    sublingual gland\ttuyến dưới lưỡi
    salivary gland\ttuyến nước bọt
    # Bệnh học
    dental caries\tsâu răng
    pulpitis (reversible / irreversible)\tviêm tủy (có hồi phục / không hồi phục)
    pulp necrosis\ttủy hoại tử
    apical periodontitis\tviêm quanh cuống
    periapical abscess\táp xe quanh cuống
    gingivitis\tviêm lợi
    periodontitis\tviêm nha chu
    periodontal pocket\ttúi nha chu
    clinical attachment loss (CAL)\tmất bám dính lâm sàng
    probing depth\tđộ sâu thăm dò
    bleeding on probing (BOP)\tchảy máu khi thăm dò
    tooth mobility\tđộ lung lay răng
    dental plaque / biofilm\tmảng bám răng / màng sinh học
    calculus\tcao răng
    pericoronitis\tviêm quanh thân răng
    dry socket (alveolar osteitis)\tviêm ổ răng khô
    impacted tooth\trăng ngầm (răng mọc kẹt)
    malocclusion\tlệch lạc khớp cắn
    occlusion\tkhớp cắn
    overjet\tđộ cắn chìa
    overbite\tđộ cắn phủ
    crossbite\tcắn chéo
    open bite\tcắn hở
    deep bite\tcắn sâu
    crowding\tchen chúc răng
    Angle Class I / II / III\tloại I / II / III theo Angle
    bruxism\ttật nghiến răng
    xerostomia\tkhô miệng
    halitosis\thôi miệng
    trismus\tkhít hàm
    fluorosis\tnhiễm fluor răng
    odontogenic\tcó nguồn gốc do răng
    odontogenic keratocyst\tnang sừng do răng
    dentigerous cyst\tnang thân răng
    radicular cyst\tnang chân răng
    ameloblastoma\tu nguyên bào men (ameloblastoma)
    odontoma\tu răng
    osteomyelitis\tviêm xương tủy
    osteoradionecrosis\thoại tử xương do tia xạ
    medication-related osteonecrosis of the jaw (MRONJ)\thoại tử xương hàm liên quan đến thuốc (MRONJ)
    oral squamous cell carcinoma\tung thư biểu mô tế bào vảy khoang miệng
    leukoplakia\tbạch sản
    erythroplakia\thồng sản
    oral lichen planus\tlichen phẳng miệng
    cleft lip and palate\tkhe hở môi – vòm miệng
    cellulitis\tviêm mô tế bào
    space infection\tnhiễm trùng khoang (khoang cân)
    Ludwig's angina\tviêm tấy lan tỏa sàn miệng (Ludwig)
    # Chấn thương – phẫu thuật
    mandibular fracture\tgãy xương hàm dưới
    Le Fort I / II / III fracture\tgãy xương hàm trên Le Fort I / II / III
    zygomaticomaxillary complex (ZMC) fracture\tgãy phức hợp gò má – hàm trên
    open reduction and internal fixation (ORIF)\tnắn chỉnh mở và cố định trong (ORIF)
    maxillomandibular fixation (MMF)\tcố định hai hàm (MMF)
    orthognathic surgery\tphẫu thuật chỉnh hình xương hàm
    osteotomy\tcắt xương
    bilateral sagittal split osteotomy (BSSO)\tphẫu thuật cắt tách dọc cành cao hai bên (BSSO)
    genioplasty\ttạo hình cằm
    distraction osteogenesis\tkéo giãn tạo xương
    tooth extraction\tnhổ răng
    surgical extraction\tnhổ răng phẫu thuật
    mucoperiosteal flap\tvạt niêm mạc – màng xương
    suture\tkhâu / chỉ khâu
    biopsy (incisional / excisional)\tsinh thiết (một phần / toàn bộ)
    bone graft\tghép xương
    autograft / allograft / xenograft\tghép tự thân / ghép đồng loại / ghép dị loại
    guided bone regeneration (GBR)\ttái tạo xương có hướng dẫn (GBR)
    guided tissue regeneration (GTR)\ttái tạo mô có hướng dẫn (GTR)
    sinus lift (sinus floor augmentation)\tnâng xoang (nâng sàn xoang hàm)
    dental implant\timplant nha khoa (trụ cấy ghép)
    osseointegration\ttích hợp xương
    abutment\ttrụ phục hình (abutment)
    local anesthesia\tgây tê tại chỗ
    inferior alveolar nerve block (IANB)\tgây tê thần kinh huyệt răng dưới (gây tê gai Spix)
    infiltration anesthesia\tgây tê thấm (gây tê cận chóp)
    general anesthesia\tgây mê toàn thân
    # Nội nha – chữa răng
    endodontics\tnội nha
    root canal treatment\tđiều trị tủy (điều trị nội nha)
    pulp capping (direct / indirect)\tchụp tủy (trực tiếp / gián tiếp)
    pulpotomy\tlấy tủy buồng
    pulpectomy\tlấy tủy toàn bộ
    apicoectomy\tcắt cuống răng
    working length\tchiều dài làm việc
    obturation\ttrám bít ống tủy
    gutta-percha\tgutta-percha
    access cavity\txoang mở tủy
    cavity preparation\tsửa soạn xoang trám
    restoration\tphục hồi (miếng trám)
    composite resin\tnhựa composite
    glass ionomer cement (GIC)\txi măng glass ionomer (GIC)
    amalgam\tamalgam
    pit and fissure sealant\tchất trám bít hố rãnh
    rubber dam\tđê cao su
    # Nha chu
    periodontics\tnha chu học
    scaling and root planing (SRP)\tcạo cao răng và xử lý mặt chân răng
    flap surgery\tphẫu thuật lật vạt
    gingivectomy\tcắt lợi
    crown lengthening\tlàm dài thân răng
    gingival recession\ttụt lợi
    # Phục hình
    prosthodontics\tphục hình răng
    crown (prosthetic)\tmão răng (chụp răng)
    fixed partial denture / bridge\tcầu răng
    complete denture\thàm giả toàn phần (tháo lắp)
    removable partial denture (RPD)\thàm giả bán phần tháo lắp
    veneer\tmặt dán sứ (veneer)
    inlay / onlay\tinlay / onlay
    impression\tdấu răng (lấy dấu)
    vertical dimension of occlusion (VDO)\tkích thước dọc khớp cắn
    centric relation\tquan hệ trung tâm
    maximum intercuspation\tlồng múi tối đa
    # Chỉnh nha
    orthodontics\tchỉnh nha
    bracket\tmắc cài
    archwire\tdây cung
    clear aligner\tkhay chỉnh nha trong suốt
    retainer\thàm duy trì
    anchorage\tneo chặn
    miniscrew (TAD)\tvít neo chặn (TAD)
    cephalometric analysis\tphân tích phim sọ nghiêng (cephalometric)
    # Chẩn đoán hình ảnh
    periapical radiograph\tphim quanh chóp
    bitewing radiograph\tphim cắn cánh
    panoramic radiograph\tphim toàn cảnh (panorama)
    cone-beam computed tomography (CBCT)\tchụp cắt lớp vi tính chùm tia hình nón (CBCT)
    radiolucent\tthấu quang
    radiopaque\tcản quang
    # Nha khoa trẻ em – cộng đồng
    pediatric dentistry\trăng trẻ em
    early childhood caries (ECC)\tsâu răng sớm ở trẻ nhỏ (ECC)
    space maintainer\tbộ giữ khoảng
    fluoride varnish\tvecni fluor
    """
}
