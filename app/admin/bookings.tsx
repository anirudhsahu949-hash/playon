import {
  View, Text, StyleSheet, SafeAreaView, StatusBar, FlatList,
  TouchableOpacity, TextInput, Alert, ActivityIndicator,
  RefreshControl, Modal, ScrollView, Platform,
} from "react-native";
import { useEffect, useMemo, useState } from "react";
import { db } from "../../firebaseConfig";
import { collection, getDocs } from "firebase/firestore";
import { Ionicons } from "@expo/vector-icons";
import AdminNavBar from "./adminavabar";

const DARK = "#0A0F1E";
const ACCENT = "#0EA5A4";

type Booking = {
  id: string; userId?: string; userName?: string; userEmail?: string;
  userPhone?: string; userLocation?: string; turfName?: string; turfId?: string;
  ownerId?: string; ownerName?: string; date?: any; dateString?: string;
  selectedSlots?: string[]; slotTime?: string; slot?: string;
  totalAmount?: number; paidAmount?: number; advanceAmount?: number;
  remainingAmount?: number; price?: number; paymentStatus?: string;
  status?: string; bookingType?: string; refundStatus?: string;
  refundAmount?: number; source?: string;
};

type StatusTab = "all"|"today"|"upcoming"|"pending"|"confirmed"|"completed"|"cancelled";
type TimeFrame = "all"|"7d"|"1m"|"3m"|"6m"|"custom";

function getSafeDate(v: any): Date | null {
  if (!v) return null;
  if (typeof v?.toDate === "function") return v.toDate();
  const d = new Date(v); return isNaN(d.getTime()) ? null : d;
}
function fmtDate(v: any): string {
  const d = getSafeDate(v); if (!d) return "—";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
function fmtSlots(b: Booking): string {
  if (Array.isArray(b.selectedSlots) && b.selectedSlots.length > 0)
    return b.selectedSlots[0] + (b.selectedSlots.length > 1 ? ` +${b.selectedSlots.length - 1}` : "");
  return b.slotTime || b.slot || "—";
}
function getTotal(b: Booking)     { return Number(b.totalAmount ?? b.paidAmount ?? b.price ?? 0); }
function getPaid(b: Booking)      { return Number(b.paidAmount ?? b.advanceAmount ?? (b.paymentStatus === "fully_paid" ? getTotal(b) : 0)); }
function getRemaining(b: Booking) { return Number(b.remainingAmount ?? Math.max(getTotal(b) - getPaid(b), 0)); }
function fmt(n: number)           { return n >= 1000 ? `₹${(n/1000).toFixed(1)}K` : `₹${n}`; }

const STATUS_TABS: {key: StatusTab; label: string}[] = [
  {key:"all",label:"All"},{key:"today",label:"Today"},{key:"upcoming",label:"Upcoming"},
  {key:"pending",label:"Pending"},{key:"confirmed",label:"Confirmed"},
  {key:"completed",label:"Completed"},{key:"cancelled",label:"Cancelled"},
];
const TIME_FRAMES: {key: TimeFrame; label: string}[] = [
  {key:"all",label:"All time"},{key:"7d",label:"7 days"},{key:"1m",label:"1 month"},
  {key:"3m",label:"3 months"},{key:"6m",label:"6 months"},{key:"custom",label:"Custom"},
];
const SC: Record<string,{bg:string;color:string}> = {
  confirmed:{bg:"#DCFCE7",color:"#15803D"}, pending:{bg:"#FEF3C7",color:"#B45309"},
  completed:{bg:"#F3F4F6",color:"#374151"}, cancelled:{bg:"#FEE2E2",color:"#DC2626"},
};

export default function AdminBookings() {
  const [bookings, setBookings]     = useState<Booking[]>([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch]         = useState("");
  const [statusTab, setStatusTab]   = useState<StatusTab>("all");
  const [timeFrame, setTimeFrame]   = useState<TimeFrame>("all");
  const [detail, setDetail]         = useState<Booking | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo]     = useState("");
  const [customActive, setCustomActive] = useState(false);

  useEffect(() => { fetchBookings(); }, []);

  const fetchBookings = async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    try {
      const snap = await getDocs(collection(db, "bookings"));
      const data = snap.docs.map((d) => ({id: d.id, ...d.data()} as Booking))
        .sort((a,b) => (getSafeDate(b.date||b.dateString)?.getTime()??0) - (getSafeDate(a.date||a.dateString)?.getTime()??0));
      setBookings(data);
    } catch { Alert.alert("Error","Could not load bookings."); }
    finally { setLoading(false); setRefreshing(false); }
  };

  const timeFiltered = useMemo(() => {
    if (timeFrame === "all") return bookings;
    if (timeFrame === "custom" && customActive) {
      const from = customFrom ? new Date(customFrom) : null;
      const to   = customTo   ? new Date(customTo)   : null;
      if (to) to.setHours(23,59,59);
      return bookings.filter((b) => {
        const d = getSafeDate(b.date||b.dateString); if (!d) return false;
        if (from && d < from) return false;
        if (to   && d > to)   return false;
        return true;
      });
    }
    const c = new Date();
    if (timeFrame==="7d") c.setDate(c.getDate()-7);
    if (timeFrame==="1m") c.setMonth(c.getMonth()-1);
    if (timeFrame==="3m") c.setMonth(c.getMonth()-3);
    if (timeFrame==="6m") c.setMonth(c.getMonth()-6);
    return bookings.filter((b) => { const d = getSafeDate(b.date||b.dateString); return d && d >= c; });
  }, [bookings, timeFrame, customActive, customFrom, customTo]);

 

  const filtered = useMemo(() => {
    const now = new Date(); const today = new Date().toDateString();
    let data = [...timeFiltered];
    if (statusTab==="today")     data = data.filter((b) => getSafeDate(b.date||b.dateString)?.toDateString()===today);
    else if (statusTab==="upcoming")  data = data.filter((b) => { const d=getSafeDate(b.date||b.dateString); return d&&d>now&&b.status!=="cancelled"; });
    else if (statusTab==="pending")   data = data.filter((b) => b.status==="pending");
    else if (statusTab==="confirmed") data = data.filter((b) => b.status==="confirmed");
    else if (statusTab==="completed") data = data.filter((b) => b.status==="completed");
    else if (statusTab==="cancelled") data = data.filter((b) => b.status==="cancelled");
    const q = search.trim().toLowerCase();
    if (q) data = data.filter((b) =>
      [b.userName,b.userPhone,b.turfName,b.ownerName,b.userEmail,b.status,b.id].some((f) => f?.toLowerCase().includes(q))
    );
    return data;
  }, [timeFiltered, statusTab, search]);

  const renderBooking = ({item}: {item: Booking}) => {
    const sc = SC[item.status||"pending"] || SC.pending;
    const slots = Array.isArray(item.selectedSlots) ? item.selectedSlots : item.slotTime ? [item.slotTime] : [];
    return (
      <TouchableOpacity style={s.card} activeOpacity={0.85} onPress={() => setDetail(item)}>
        <View style={s.cardTop}>
          <View style={{flex:1}}>
            <Text style={s.cardUser}>{item.userName||"Unknown"}</Text>
            <Text style={s.cardTurf}>{item.turfName||"Unknown Turf"}</Text>
          </View>
          <View style={[s.badge,{backgroundColor:sc.bg}]}>
            <Text style={[s.badgeText,{color:sc.color}]}>
              {(item.status||"pending").charAt(0).toUpperCase()+(item.status||"pending").slice(1)}
            </Text>
          </View>
        </View>
        <View style={s.chipRow}>
          <View style={s.chip}><Ionicons name="calendar-outline" size={11} color="#6B7280"/><Text style={s.chipText}>{fmtDate(item.date||item.dateString)}</Text></View>
          {slots[0]?<View style={s.chip}><Ionicons name="time-outline" size={11} color="#6B7280"/><Text style={s.chipText}>{fmtSlots(item)}</Text></View>:null}
          {item.userPhone?<View style={s.chip}><Ionicons name="call-outline" size={11} color="#6B7280"/><Text style={s.chipText}>{item.userPhone}</Text></View>:null}
          {item.ownerName?<View style={s.chip}><Ionicons name="person-outline" size={11} color="#6B7280"/><Text style={s.chipText}>{item.ownerName}</Text></View>:null}
        </View>
        <View style={s.payRow}>
          <View>
            <Text style={s.payTotal}>{fmt(getTotal(item))}</Text>
            <Text style={s.paySub}>Paid {fmt(getPaid(item))}{getRemaining(item)>0?` · Due ${fmt(getRemaining(item))}`:" · Fully paid"}</Text>
          </View>
          <View style={item.bookingType==="full"?s.pillFull:s.pillAdv}>
            <Text style={s.pillText}>{item.bookingType==="full"?"Full":"Advance"}</Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  if (loading) return (
    <SafeAreaView style={s.loadWrap}>
      <StatusBar barStyle="light-content" backgroundColor={DARK}/>
      <ActivityIndicator size="large" color={ACCENT}/>
      <Text style={s.loadText}>Loading bookings...</Text>
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={DARK}/>
      <FlatList
        data={filtered} keyExtractor={(i)=>i.id} renderItem={renderBooking}
        contentContainerStyle={s.list} showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={()=>fetchBookings(true)} tintColor={ACCENT}/>}
        ListHeaderComponent={
          <View>
            <View style={s.hero}>
              <View style={s.glow1}/><View style={s.glow2}/>
              <Text style={s.heroTag}>Admin · Bookings</Text>
              <Text style={s.heroTitle}>Booking Records</Text>
              <Text style={s.heroSub}>All bookings across every turf and customer.</Text>
             
            </View>

            {/* Search */}
            <View style={s.searchBar}>
              <Ionicons name="search-outline" size={16} color="#9CA3AF" style={{marginRight:8}}/>
              <TextInput style={s.searchInput} placeholder="Search name, phone, turf..." placeholderTextColor="#9CA3AF" value={search} onChangeText={setSearch}/>
              {search.length>0&&<TouchableOpacity onPress={()=>setSearch("")}><Ionicons name="close-circle" size={16} color="#9CA3AF"/></TouchableOpacity>}
            </View>

            {/* Time frames */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tfRow}>
              {TIME_FRAMES.map((tf)=>{
                const active = timeFrame===tf.key;
                return (
                  <TouchableOpacity key={tf.key} style={[s.tfChip,active&&s.tfChipActive]}
                    onPress={()=>{ setTimeFrame(tf.key); if(tf.key==="custom")setFilterOpen(true); else setCustomActive(false); }}>
                    <Text style={[s.tfText,active&&s.tfTextActive]}>{tf.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {timeFrame==="custom"&&customActive&&(
              <View style={s.customBanner}>
                <Ionicons name="calendar-outline" size={14} color="#7C3AED"/>
                <Text style={s.customBannerText}>{customFrom||"—"} → {customTo||"—"}</Text>
                <TouchableOpacity onPress={()=>setFilterOpen(true)}><Text style={s.customEdit}>Edit</Text></TouchableOpacity>
              </View>
            )}

            {/* Status tabs */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tabsRow}>
              {STATUS_TABS.map((tab)=>{
                const active = statusTab===tab.key;
                return (
                  <TouchableOpacity key={tab.key} style={[s.tab,active&&s.tabActive]} onPress={()=>setStatusTab(tab.key)}>
                    <Text style={[s.tabText,active&&s.tabTextActive]}>{tab.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <Text style={s.resultCount}>{filtered.length} booking{filtered.length!==1?"s":""}</Text>
          </View>
        }
        ListEmptyComponent={
          <View style={s.empty}>
            <Ionicons name="calendar-outline" size={40} color="#D1D5DB"/>
            <Text style={s.emptyTitle}>No bookings found</Text>
            <Text style={s.emptySub}>Try adjusting filters or search.</Text>
          </View>
        }
      />

      {/* Detail modal */}
      <Modal visible={!!detail} animationType="slide" transparent>
        <View style={s.backdrop}>
          <View style={s.sheet}>
            <View style={s.handle}/>
            {detail&&(()=>{
              const sc = SC[detail.status||"pending"]||SC.pending;
              return (
                <ScrollView showsVerticalScrollIndicator={false}>
                  <View style={s.detailHeader}>
                    <Text style={s.detailTitle}>Booking Detail</Text>
                    <TouchableOpacity style={s.closeBtn} onPress={()=>setDetail(null)}>
                      <Ionicons name="close" size={20} color="#374151"/>
                    </TouchableOpacity>
                  </View>
                  <View style={[s.statusBanner,{backgroundColor:sc.bg}]}>
                    <Text style={[s.statusBannerText,{color:sc.color}]}>{(detail.status||"pending").toUpperCase()}</Text>
                    <Text style={s.bookingId}>#{detail.id.slice(0,10)}</Text>
                  </View>
                  {[
                    {title:"Customer",rows:[
                      {icon:"person-outline",label:"Name",value:detail.userName||"—"},
                      {icon:"mail-outline",label:"Email",value:detail.userEmail||"—"},
                      {icon:"call-outline",label:"Phone",value:detail.userPhone||"—"},
                      {icon:"location-outline",label:"Location",value:detail.userLocation||"—"},
                    ]},
                    {title:"Booking",rows:[
                      {icon:"location-outline",label:"Turf",value:detail.turfName||"—"},
                      {icon:"people-outline",label:"Owner",value:detail.ownerName||"—"},
                      {icon:"calendar-outline",label:"Date",value:fmtDate(detail.date||detail.dateString)},
                      {icon:"time-outline",label:"Slots",value:fmtSlots(detail)},
                      {icon:"phone-portrait-outline",label:"Source",value:detail.source||"App"},
                    ]},
                    {title:"Payment",rows:[
                      {icon:"cash-outline",label:"Total",value:`₹${getTotal(detail)}`},
                      {icon:"checkmark-circle-outline",label:"Paid",value:`₹${getPaid(detail)}`},
                      {icon:"alert-circle-outline",label:"Remaining",value:getRemaining(detail)>0?`₹${getRemaining(detail)}`:"Fully paid"},
                      {icon:"card-outline",label:"Type",value:detail.bookingType==="full"?"Full Payment":"Advance"},
                      {icon:"shield-checkmark-outline",label:"Payment Status",value:detail.paymentStatus||"—"},
                    ]},
                  ].map(({title,rows})=>(
                    <View key={title} style={s.detailSection}>
                      <Text style={s.detailSectionTitle}>{title}</Text>
                      {rows.map((row)=>(
                        <View key={row.label} style={s.detailRow}>
                          <View style={s.detailIcon}><Ionicons name={row.icon as any} size={15} color="#6B7280"/></View>
                          <View style={{flex:1}}>
                            <Text style={s.detailLabel}>{row.label}</Text>
                            <Text style={s.detailValue}>{row.value}</Text>
                          </View>
                        </View>
                      ))}
                    </View>
                  ))}
                  {detail.status==="cancelled"&&detail.refundStatus&&(
                    <View style={s.refundBox}>
                      <Ionicons name="refresh-circle-outline" size={20} color="#7C3AED"/>
                      <View style={{flex:1,marginLeft:10}}>
                        <Text style={s.refundTitle}>Refund</Text>
                        <Text style={s.refundValue}>{detail.refundStatus}{detail.refundAmount?` · ₹${detail.refundAmount}`:""}</Text>
                      </View>
                    </View>
                  )}
                  <TouchableOpacity style={s.closeFullBtn} onPress={()=>setDetail(null)}>
                    <Text style={s.closeFullBtnText}>Close</Text>
                  </TouchableOpacity>
                  <View style={{height:24}}/>
                </ScrollView>
              );
            })()}
          </View>
        </View>
      </Modal>

      {/* Custom date picker modal */}
      <Modal visible={filterOpen} animationType="slide" transparent>
        <View style={s.backdrop}>
          <View style={[s.sheet,{maxHeight:"52%"}]}>
            <View style={s.handle}/>
            <Text style={s.detailTitle}>Custom Date Range</Text>
            <Text style={[s.detailLabel,{marginTop:4,marginBottom:16}]}>Format: YYYY-MM-DD</Text>
            <Text style={s.fieldLabel}>From date</Text>
            <TextInput style={s.dateInput} placeholder="2025-01-01" placeholderTextColor="#9CA3AF" value={customFrom} onChangeText={setCustomFrom}/>
            <Text style={s.fieldLabel}>To date</Text>
            <TextInput style={s.dateInput} placeholder="2025-12-31" placeholderTextColor="#9CA3AF" value={customTo} onChangeText={setCustomTo}/>
            <TouchableOpacity style={s.applyBtn} onPress={()=>{ setCustomActive(true); setFilterOpen(false); }}>
              <Text style={s.applyBtnText}>Apply Range</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.cancelBtn} onPress={()=>{ setFilterOpen(false); if(!customActive) setTimeFrame("all"); }}>
              <Text style={s.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <AdminNavBar/>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:{flex:1,backgroundColor:"#F0F4F8"}, loadWrap:{flex:1,justifyContent:"center",alignItems:"center",backgroundColor:DARK},
  loadText:{marginTop:12,color:"#9CA3AF",fontSize:15,fontWeight:"600"}, list:{paddingBottom:100},
  hero:{backgroundColor:DARK,paddingHorizontal:20,paddingTop:Platform.OS==="android"?(StatusBar.currentHeight||0)+14:18,paddingBottom:24,overflow:"hidden"},
  glow1:{position:"absolute",top:-40,right:-40,width:200,height:200,borderRadius:100,backgroundColor:"rgba(14,165,164,0.13)"},
  glow2:{position:"absolute",bottom:-60,left:-40,width:180,height:180,borderRadius:90,backgroundColor:"rgba(96,165,250,0.10)"},
  heroTag:{color:"#6EE7B7",fontSize:11,fontWeight:"800",letterSpacing:1.5,textTransform:"uppercase"},
  heroTitle:{color:"#FFFFFF",fontSize:28,fontWeight:"900",marginTop:4}, heroSub:{color:"#9CA3AF",fontSize:13,lineHeight:20,marginTop:6},
  
  
  
  
  
  searchBar:{flexDirection:"row",alignItems:"center",backgroundColor:"#FFFFFF",borderRadius:14,paddingHorizontal:14,marginHorizontal:16,marginTop:16,borderWidth:1,borderColor:"#E5E7EB",height:46},
  searchInput:{flex:1,fontSize:14,color:"#111827"},
  tfRow:{paddingHorizontal:16,paddingTop:12,paddingBottom:4,gap:8},
  tfChip:{paddingHorizontal:14,paddingVertical:7,borderRadius:999,backgroundColor:"#FFFFFF",borderWidth:1,borderColor:"#E5E7EB"},
  tfChipActive:{backgroundColor:"#7C3AED",borderColor:"#7C3AED"},
  tfText:{fontSize:12,fontWeight:"700",color:"#374151"}, tfTextActive:{color:"#FFFFFF"},
  customBanner:{flexDirection:"row",alignItems:"center",gap:8,marginHorizontal:16,marginTop:8,backgroundColor:"#F5F3FF",borderRadius:10,padding:10,borderWidth:1,borderColor:"#DDD6FE"},
  customBannerText:{flex:1,fontSize:12,color:"#5B21B6",fontWeight:"600"}, customEdit:{fontSize:12,color:"#7C3AED",fontWeight:"700"},
  tabsRow:{paddingHorizontal:16,paddingTop:10,paddingBottom:4,gap:8},
  tab:{paddingHorizontal:14,paddingVertical:7,borderRadius:999,backgroundColor:"#FFFFFF",borderWidth:1,borderColor:"#E5E7EB"},
  tabActive:{backgroundColor:DARK,borderColor:DARK}, tabText:{fontSize:12,fontWeight:"700",color:"#374151"}, tabTextActive:{color:"#FFFFFF"},
  resultCount:{paddingHorizontal:16,paddingTop:10,paddingBottom:8,fontSize:12,color:"#9CA3AF",fontWeight:"700"},
  card:{backgroundColor:"#FFFFFF",marginHorizontal:16,marginBottom:12,borderRadius:18,padding:14,borderWidth:1,borderColor:"#E5E7EB",shadowColor:"#000",shadowOffset:{width:0,height:2},shadowOpacity:0.05,shadowRadius:6,elevation:2},
  cardTop:{flexDirection:"row",alignItems:"flex-start",marginBottom:10},
  cardUser:{fontSize:16,fontWeight:"800",color:"#111827"}, cardTurf:{fontSize:12,color:"#6B7280",marginTop:3,fontWeight:"600"},
  badge:{paddingHorizontal:10,paddingVertical:4,borderRadius:999}, badgeText:{fontSize:10,fontWeight:"800"},
  chipRow:{flexDirection:"row",gap:6,flexWrap:"wrap",marginBottom:10},
  chip:{flexDirection:"row",alignItems:"center",gap:4,backgroundColor:"#F9FAFB",borderRadius:8,paddingHorizontal:8,paddingVertical:4,borderWidth:1,borderColor:"#F3F4F6"},
  chipText:{fontSize:10,color:"#374151",fontWeight:"600"},
  payRow:{flexDirection:"row",justifyContent:"space-between",alignItems:"center",paddingTop:10,borderTopWidth:1,borderTopColor:"#F3F4F6"},
  payTotal:{fontSize:17,fontWeight:"900",color:"#111827"}, paySub:{fontSize:11,color:"#9CA3AF",marginTop:2,fontWeight:"500"},
  pillFull:{backgroundColor:"#DCFCE7",paddingHorizontal:10,paddingVertical:4,borderRadius:999},
  pillAdv:{backgroundColor:"#FEF3C7",paddingHorizontal:10,paddingVertical:4,borderRadius:999}, pillText:{fontSize:10,fontWeight:"800",color:"#374151"},
  empty:{margin:16,backgroundColor:"#FFFFFF",borderRadius:20,padding:32,alignItems:"center",borderWidth:1,borderColor:"#E5E7EB"},
  emptyTitle:{fontSize:17,fontWeight:"800",color:"#111827",marginTop:12}, emptySub:{fontSize:13,color:"#9CA3AF",marginTop:6,textAlign:"center"},
  backdrop:{flex:1,backgroundColor:"rgba(0,0,0,0.5)",justifyContent:"flex-end"},
  sheet:{backgroundColor:"#FFFFFF",borderTopLeftRadius:28,borderTopRightRadius:28,paddingHorizontal:20,paddingTop:12,paddingBottom:Platform.OS==="ios"?34:20,maxHeight:"94%"},
  handle:{width:40,height:4,borderRadius:2,backgroundColor:"#E5E7EB",alignSelf:"center",marginBottom:16},
  detailHeader:{flexDirection:"row",justifyContent:"space-between",alignItems:"center",marginBottom:16},
  detailTitle:{fontSize:21,fontWeight:"900",color:"#111827"},
  closeBtn:{width:36,height:36,borderRadius:18,backgroundColor:"#F3F4F6",justifyContent:"center",alignItems:"center"},
  statusBanner:{borderRadius:12,padding:12,marginBottom:16,flexDirection:"row",justifyContent:"space-between",alignItems:"center"},
  statusBannerText:{fontSize:14,fontWeight:"800"}, bookingId:{fontSize:11,color:"#9CA3AF",fontWeight:"600"},
  detailSection:{marginBottom:14},
  detailSectionTitle:{fontSize:12,fontWeight:"800",color:"#9CA3AF",textTransform:"uppercase",letterSpacing:0.6,marginBottom:8},
  detailRow:{flexDirection:"row",alignItems:"center",gap:10,backgroundColor:"#F9FAFB",borderRadius:12,padding:12,marginBottom:6,borderWidth:1,borderColor:"#F3F4F6"},
  detailIcon:{width:32,height:32,borderRadius:10,backgroundColor:"#F3F4F6",justifyContent:"center",alignItems:"center"},
  detailLabel:{fontSize:10,color:"#9CA3AF",fontWeight:"700",textTransform:"uppercase"},
  detailValue:{fontSize:14,color:"#111827",fontWeight:"600",marginTop:2},
  refundBox:{flexDirection:"row",alignItems:"center",backgroundColor:"#F5F3FF",borderRadius:12,padding:14,marginBottom:16,borderWidth:1,borderColor:"#DDD6FE"},
  refundTitle:{fontSize:11,color:"#7C3AED",fontWeight:"700",textTransform:"uppercase"},
  refundValue:{fontSize:14,color:"#5B21B6",fontWeight:"700",marginTop:2},
  closeFullBtn:{backgroundColor:"#F3F4F6",paddingVertical:15,borderRadius:16,alignItems:"center"},
  closeFullBtnText:{color:"#374151",fontWeight:"700",fontSize:15},
  fieldLabel:{fontSize:12,fontWeight:"700",color:"#374151",marginBottom:6,marginTop:14,textTransform:"uppercase",letterSpacing:0.4},
  dateInput:{backgroundColor:"#F9FAFB",borderWidth:1,borderColor:"#E5E7EB",borderRadius:12,paddingHorizontal:14,paddingVertical:13,fontSize:15,color:"#111827"},
  applyBtn:{backgroundColor:DARK,paddingVertical:14,borderRadius:14,alignItems:"center",marginTop:20},
  applyBtnText:{color:"#FFFFFF",fontWeight:"800",fontSize:15},
  cancelBtn:{backgroundColor:"#F3F4F6",paddingVertical:14,borderRadius:14,alignItems:"center",marginTop:10},
  cancelBtnText:{color:"#374151",fontWeight:"700",fontSize:15},
});