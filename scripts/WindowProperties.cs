using System;
using System.Runtime.InteropServices;
public static class MeterWindowProperties {
 public delegate bool EnumCallback(IntPtr h, IntPtr l);
 [DllImport("user32.dll")] static extern bool EnumWindows(EnumCallback callback, IntPtr l);
 [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
 public static IntPtr[] Windows(int pid) {
  var windows = new System.Collections.Generic.List<IntPtr>();
  EnumWindows(delegate(IntPtr h, IntPtr l) { uint owner; GetWindowThreadProcessId(h,out owner);
   if(owner==(uint)pid && IsWindowVisible(h) && (GetExtendedWindowStyle(h)&0x80)==0) windows.Add(h); return true;
  },IntPtr.Zero); return windows.ToArray();
 }
 [DllImport("user32.dll",EntryPoint="GetWindowLong")] static extern int GetWindowLong32(IntPtr h,int index);
 [DllImport("user32.dll",EntryPoint="GetWindowLongPtr")] static extern IntPtr GetWindowLong64(IntPtr h,int index);
 static long GetExtendedWindowStyle(IntPtr h) { return IntPtr.Size==8?GetWindowLong64(h,-20).ToInt64():GetWindowLong32(h,-20); }
 public static long LoadIcon(string file,int size) {
  var icon=LoadImage(IntPtr.Zero,file,1,size,size,0x10);
  if(icon==IntPtr.Zero) throw new System.ComponentModel.Win32Exception(); return icon.ToInt64();
 }
 public static void SetIcon(IntPtr h,int kind,long icon) {
  IntPtr old; if(SendMessageTimeout(h,0x80,new IntPtr(kind),new IntPtr(icon),2,1000,out old)==IntPtr.Zero) throw new System.ComponentModel.Win32Exception();
 }
 [DllImport("user32.dll")] public static extern bool DestroyIcon(IntPtr icon);
 [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)] public static extern IntPtr LoadImage(IntPtr instance,string name,uint type,int cx,int cy,uint flags);
 [DllImport("user32.dll",SetLastError=true)] public static extern IntPtr SendMessageTimeout(IntPtr h,uint message,IntPtr w,IntPtr l,uint flags,uint timeout,out IntPtr result);
 public static long Icon(IntPtr h,int kind){IntPtr value; SendMessageTimeout(h,0x7f,new IntPtr(kind),IntPtr.Zero,2,1000,out value);return value.ToInt64();}
 [StructLayout(LayoutKind.Sequential)] public struct Key {public Guid fmtid; public uint pid;}
 [StructLayout(LayoutKind.Explicit,Size=24)] public struct Value {
  [FieldOffset(0)] public ushort type; [FieldOffset(8)] public IntPtr pointer;
 }
 [ComImport,Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
 interface Store {
  [PreserveSig] int GetCount(out uint count);
  [PreserveSig] int GetAt(uint i,out Key key);
  [PreserveSig] int GetValue(ref Key key,out Value value);
  [PreserveSig] int SetValue(ref Key key,ref Value value);
  [PreserveSig] int Commit();
 }
 [DllImport("shell32.dll")] static extern int SHGetPropertyStoreForWindow(IntPtr h,ref Guid iid,out Store store);
 [DllImport("ole32.dll")] static extern int PropVariantClear(ref Value value);
 public static void Write(IntPtr h,uint id,string text) {
  var iid=new Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"); Store store;
  Marshal.ThrowExceptionForHR(SHGetPropertyStoreForWindow(h,ref iid,out store));
  var key=new Key{fmtid=new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"),pid=id}; Value value=new Value();
  try {if(!String.IsNullOrEmpty(text)){value.type=31;value.pointer=Marshal.StringToCoTaskMemUni(text);}
   try{Marshal.ThrowExceptionForHR(store.SetValue(ref key,ref value));Marshal.ThrowExceptionForHR(store.Commit());}
   finally{PropVariantClear(ref value);}
  } finally{Marshal.ReleaseComObject(store);}
 }
 public static string Read(IntPtr h,uint id) {
  var iid=new Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"); Store store;
  Marshal.ThrowExceptionForHR(SHGetPropertyStoreForWindow(h,ref iid,out store));
  var key=new Key{fmtid=new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"),pid=id}; Value value;
  try {Marshal.ThrowExceptionForHR(store.GetValue(ref key,out value));
   try{return value.type==31?Marshal.PtrToStringUni(value.pointer):"VT="+value.type;}
   finally{PropVariantClear(ref value);}
  } finally{Marshal.ReleaseComObject(store);}
 }
}
